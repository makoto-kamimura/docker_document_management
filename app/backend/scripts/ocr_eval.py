"""OCR の精度評価（文字誤り率 CER・処理時間・メモリ）。

実際の処理（image_processing.scan_page → pdf_export の ocrmypdf/Tesseract → ocr_text の後処理、
paddle_ocr の PaddleOCR）を、方式ごとに流して比べる。

使い方（ocr-worker イメージに CJK フォントと rapidocr を足したイメージで実行する。
手順は docs/runbooks/operation.md の「OCR の精度評価」）:

    # 合成サンプル（スマホで撮った書類写真に似せた画像と正解テキスト）を作る
    python scripts/ocr_eval.py synth --out /work/samples --n 12
    # 評価する（実物の写真も xxx.jpg と正解 xxx.txt を同じフォルダに置けば一緒に測れる）
    python scripts/ocr_eval.py run --samples /work/samples --out /work/result

CER = 編集距離 ÷ 正解の文字数。NFKC 正規化し、空白・改行を除いて比べる（読む順番は比べる）。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import resource
import statistics
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ---------------------------------------------------------------- 合成サンプル

PASSAGES = [
    ("運動会のお知らせ",
     "保護者の皆様へ\n秋季運動会を十月十二日（土）に開催します。雨天の場合は十三日（日）に延期します。"
     "お弁当と水筒をご用意ください。児童の集合時刻は午前八時十五分です。\n"
     "当日の連絡はメールでお送りします。プログラムは別紙のとおりです。"
     "駐車場はありませんので、徒歩または自転車でお越しください。"),
    ("給食だより",
     "十一月の献立表をお届けします。アレルギーのあるお子様は、献立表の材料欄を必ずご確認ください。"
     "今月はハンバーグ、カレーライス、ミートソーススパゲッティが登場します。"
     "牛乳は毎日二百ミリリットルです。給食費の引き落としは十一月二十日です。"),
    ("お薬の説明書",
     "ロキソプロフェンナトリウム錠六十ミリグラム\n一日三回 毎食後 一回一錠 七日分\n"
     "痛みや熱をやわらげるお薬です。胃の不快感が出ることがあります。"
     "空腹時を避けて服用してください。ほかのお薬と一緒に飲む場合は薬剤師にご相談ください。"),
    ("自治会からのお願い",
     "ゴミ出しのルールが変わります。燃えるゴミは月曜日と木曜日、プラスチックは水曜日です。"
     "ペットボトルはキャップとラベルを外して、中を軽くすすいでから出してください。"
     "回収は午前八時三十分までにお願いします。ご協力をよろしくお願いいたします。"),
    ("電気料金のお知らせ",
     "ご使用量 三百十二キロワット時\n請求金額 九千八百七十六円\n"
     "検針日 十月二十八日 次回検針予定日 十一月二十七日\n"
     "口座振替日は十一月十五日です。インターネットのマイページでも明細をご確認いただけます。"),
    ("懇談会の出欠票",
     "個人懇談会を十一月二十五日から二十九日に行います。ご都合のよい日時に丸を付け、"
     "出欠票を十一月八日（金）までに担任へ提出してください。"
     "時間は一人十五分程度です。ご兄弟で通学されている場合は、続けての時間にいたします。"),
    ("サッカー教室 参加者募集",
     "小学一年生から六年生までを対象に、サッカー教室を開きます。コーチは地元クラブの選手です。"
     "参加費は無料です。運動しやすい服装で、タオルと飲み物を持ってきてください。"
     "申し込みは市のホームページのフォームから受け付けます。定員は先着三十名です。"),
    ("避難訓練の実施について",
     "十一月六日（水）の二時間目に避難訓練を行います。地震のあとに火災が起きた想定です。"
     "ハンカチで口と鼻をおさえ、先生の指示に従って校庭へ避難します。"
     "引き渡し訓練も行いますので、保護者の方は午後二時までに体育館へお越しください。"),
]
VERTICAL = {2, 5}  # この番号の文面は縦書きでも作る

ROTATE_IN_VERTICAL = set("ー－〜～…（）「」『』【】()-")
PUNCT_TOP_RIGHT = set("、。，．")


def _font(path: str, size: int):
    from PIL import ImageFont

    # Noto CJK の .ttc は index 0 が JP（環境により異なるので名前で探す）
    for idx in range(10):
        try:
            f = ImageFont.truetype(path, size, index=idx)
        except Exception:
            break
        if "JP" in " ".join(f.getname()):
            return f
    return ImageFont.truetype(path, size)


def _render_horizontal(title: str, body: str, font_path: str, px: int):
    from PIL import Image, ImageDraw

    W, H = 2067, 2923  # A4 縦を 250dpi で
    page = Image.new("L", (W, H), 250)
    d = ImageDraw.Draw(page)
    margin = 170
    tf = _font(font_path, int(px * 1.5))
    f = _font(font_path, px)
    y = margin
    d.text((margin, y), title, font=tf, fill=20)
    y += int(px * 1.5 * 2.0)
    lines_gt = [title]
    for para in body.split("\n"):
        line = ""
        for ch in para:
            if f.getlength(line + ch) > W - 2 * margin:
                d.text((margin, y), line, font=f, fill=25)
                lines_gt.append(line)
                y += int(px * 1.7)
                line = ""
            line += ch
        if line:
            d.text((margin, y), line, font=f, fill=25)
            lines_gt.append(line)
            y += int(px * 1.7)
        y += int(px * 0.6)
    return page, "\n".join(lines_gt)


def _render_vertical(title: str, body: str, font_path: str, px: int):
    from PIL import Image, ImageDraw

    W, H = 2067, 2923
    page = Image.new("L", (W, H), 250)
    margin = 190
    f = _font(font_path, px)
    col_w = int(px * 1.75)
    x = W - margin - px
    cols_gt = []

    def draw_col(text: str, x: int, font, size: int):
        y = margin
        for ch in text:
            glyph = Image.new("L", (size * 2, size * 2), 0)
            ImageDraw.Draw(glyph).text((size // 2, size // 2), ch, font=font, fill=255)
            if ch in ROTATE_IN_VERTICAL:
                glyph = glyph.rotate(-90, center=(size, size))
            dx, dy = 0, 0
            if ch in PUNCT_TOP_RIGHT:
                dx, dy = int(size * 0.55), -int(size * 0.55)
            ink = Image.new("L", glyph.size, 25)
            page.paste(ink, (x - size // 2 + dx, y - size // 2 + dy), glyph)
            y += int(size * 1.08)
        return y

    chars_per_col = int((H - 2 * margin) / (px * 1.08)) - 1
    text = title + "\n" + body
    for para in text.split("\n"):
        while para:
            col, para = para[:chars_per_col], para[chars_per_col:]
            draw_col(col, x, f, px)
            cols_gt.append(col)
            x -= col_w
        x -= int(px * 0.5)
    return page, "\n".join(cols_gt)


def _photo(page, rng: random.Random, hard: bool):
    """紙を机に置いてスマホで撮ったような写真にする（台形ゆがみ・影・ぼけ・ノイズ・JPEG）。"""
    import cv2
    import numpy as np

    pw, ph = page.size
    W, H = (2268, 3024) if hard else (3024, 4032)
    bg = np.zeros((H, W, 3), np.float32)
    base = np.array([rng.randint(60, 110), rng.randint(70, 120), rng.randint(90, 150)], np.float32)
    bg[:] = base
    bg += np.random.default_rng(rng.randint(0, 10**6)).normal(0, 8, bg.shape).astype(np.float32)

    # 紙は画面の 80〜88%（撮影画面の枠に合わせた想定）。四隅を少しずつずらす
    fill = rng.uniform(0.80, 0.88)
    tw = W * fill
    th = tw * ph / pw
    if th > H * 0.92:
        th = H * 0.92
        tw = th * pw / ph
    cx, cy = W / 2, H / 2
    j = 0.035 if hard else 0.02
    dst = np.float32([
        [cx - tw / 2 + rng.uniform(-j, j) * W, cy - th / 2 + rng.uniform(-j, j) * H],
        [cx + tw / 2 + rng.uniform(-j, j) * W, cy - th / 2 + rng.uniform(-j, j) * H],
        [cx + tw / 2 + rng.uniform(-j, j) * W, cy + th / 2 + rng.uniform(-j, j) * H],
        [cx - tw / 2 + rng.uniform(-j, j) * W, cy + th / 2 + rng.uniform(-j, j) * H],
    ])
    src = np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]])
    M = cv2.getPerspectiveTransform(src, dst)
    paper = np.array(page.convert("RGB"), np.float32)
    # 紙はわずかに暖色
    paper *= np.array([0.97, 0.98, 1.0], np.float32)
    warped = cv2.warpPerspective(paper, M, (W, H), flags=cv2.INTER_AREA)
    mask = cv2.warpPerspective(np.ones((ph, pw), np.float32), M, (W, H))
    img = bg * (1 - mask[..., None]) + warped * mask[..., None]

    # 片側からの影と周辺減光
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ang = rng.uniform(0, 2 * np.pi)
    ramp = (np.cos(ang) * (xx / W - 0.5) + np.sin(ang) * (yy / H - 0.5)) + 0.5
    low = rng.uniform(0.55, 0.7) if hard else rng.uniform(0.75, 0.88)
    light = low + (1 - low) * np.clip(ramp, 0, 1)
    vignette = 1 - 0.18 * (((xx / W - 0.5) ** 2 + (yy / H - 0.5) ** 2) * 2)
    img *= (light * vignette)[..., None]

    sigma = rng.uniform(1.0, 1.6) if hard else rng.uniform(0.5, 0.9)
    img = cv2.GaussianBlur(img, (0, 0), sigma)
    img += np.random.default_rng(rng.randint(0, 10**6)).normal(0, 5 if hard else 3, img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes()


def synth(out: Path, n: int, seed: int, fonts: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    jobs = []
    for i, (title, body) in enumerate(PASSAGES):
        jobs.append((i, title, body, False))
        if i in VERTICAL:
            jobs.append((i, title, body, True))
    for k in range(n):
        i, title, body, vertical = jobs[k % len(jobs)]
        hard = k % 2 == 1
        font = fonts[k % len(fonts)]
        px = 30 if hard else 38
        render = _render_vertical if vertical else _render_horizontal
        page, gt = render(title, body, font, px)
        name = f"{k:02d}_{'v' if vertical else 'h'}_{'hard' if hard else 'easy'}_{Path(font).stem}"
        (out / f"{name}.jpg").write_bytes(_photo(page, rng, hard))
        (out / f"{name}.txt").write_text(gt, encoding="utf-8")
        print("made", name)


# ---------------------------------------------------------------- 評価


def _norm(text: str | None) -> str:
    return "".join(unicodedata.normalize("NFKC", text or "").split())


def cer(ref: str, hyp: str) -> float:
    """編集距離 ÷ 正解の文字数（空白は除いて比べる）。"""
    a, b = _norm(ref), _norm(hyp)
    if not a:
        return 0.0 if not b else 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1] / len(a)


TESS_VARIANTS = {
    "tess-color": {"mode": "color", "extra": {}},
    "tess-bw": {"mode": "bw", "extra": {}},
    "tess-color-sauvola": {"mode": "color", "extra": {"tesseract_thresholding": "sauvola"}},
    "tess-bw-sauvola": {"mode": "bw", "extra": {"tesseract_thresholding": "sauvola"}},
    # 本番の白黒モード: グレーで OCR してから PDF の画像を白黒にする（ocr_worker と同じ）
    "tess-bw-fixed": {"mode": "bw-fixed", "extra": {}},
}


def _tesseract(raw: bytes, mode: str, extra: dict) -> tuple[str, float, bytes | None]:
    from app.services import image_processing, pdf_export

    base = dict(pdf_export._OCR_ENHANCED)
    pdf_export._OCR_ENHANCED.update(extra)
    try:
        t0 = time.time()
        lang = os.environ.get("OCR_LANG", "jpn+jpn_vert+eng")
        if mode == "bw-fixed":
            _disp, _q, src = image_processing.scan_page_with_ocr_source(raw, "bw")
            pdf, text = pdf_export.build_searchable_pdf_from_images([image_processing.gray_for_ocr(src)], lang)
            bw = pdf_export.binarize_pdf_images(pdf, image_processing.binarize)
            # 白黒にしても PDF のテキスト層は変わらないこと
            layer = [subprocess.run(["pdftotext", "-", "-"], input=b, capture_output=True).stdout for b in (pdf, bw)]
            if layer[0] != layer[1]:
                print("  ! text layer changed by binarize", flush=True)
            return text, time.time() - t0, src
        disp, _q, src = image_processing.scan_page_with_ocr_source(raw, mode)
        _pdf, text = pdf_export.build_searchable_pdf_from_images([disp], lang)
        return text, time.time() - t0, src
    finally:
        pdf_export._OCR_ENHANCED.clear()
        pdf_export._OCR_ENHANCED.update(base)


def _paddle(sources: list[bytes], preset: str, max_side: int) -> tuple[list[str], float, int]:
    """別プロセスで読む（本番と同じ paddle_ocr）。処理時間と最大メモリ(MB)も返す。"""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, data in enumerate(sources):
            p = os.path.join(tmp, f"p{i:03d}.jpg")
            Path(p).write_bytes(data)
            paths.append(p)
        code = (
            "import resource,runpy,sys;"
            f"sys.argv=['paddle_ocr','--preset',{preset!r},'--max-side',{str(max_side)!r},*{paths!r}];"
            "runpy.run_module('app.services.paddle_ocr',run_name='__main__');"
            "print(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,file=sys.stderr)"
        )
        t0 = time.time()
        res = subprocess.run([sys.executable, "-c", code], capture_output=True, check=True,
                             cwd=str(Path(__file__).resolve().parents[1]))
        elapsed = time.time() - t0
        rss_kb = int(res.stderr.decode().strip().splitlines()[-1])
        return json.loads(res.stdout.decode()), elapsed, rss_kb // 1024


def run(samples: Path, out: Path, presets: list[str], max_side: int, variants: list[str]) -> None:
    from app.services.ocr_text import clean_ocr_text, text_quality
    from app.services.paddle_ocr import choose_text

    out.mkdir(parents=True, exist_ok=True)
    names = sorted(p.stem for p in samples.glob("*.jpg") if (samples / f"{p.stem}.txt").exists())
    rows: dict[str, dict] = {}
    texts: dict[str, dict] = {}
    times: dict[str, list[float]] = {}
    sources: list[bytes] = []
    for name in names:
        raw = (samples / f"{name}.jpg").read_bytes()
        gt = (samples / f"{name}.txt").read_text(encoding="utf-8")
        rows[name] = {"gt": gt}
        texts[name] = {}
        src_for_paddle = None
        for key, v in TESS_VARIANTS.items():
            if key not in variants:
                continue
            text, sec, src = _tesseract(raw, v["mode"], v["extra"])
            src_for_paddle = src_for_paddle or src
            texts[name][key] = text
            times.setdefault(key, []).append(sec)
            print(f"{name} {key} {sec:.1f}s cer={cer(gt, text):.3f}", flush=True)
        sources.append(src_for_paddle or raw)

    mem: dict[str, int] = {}
    for preset in presets:
        key = f"paddle-{preset}"
        outs, sec, rss = _paddle(sources, preset, max_side)
        mem[key] = rss
        times[key] = [sec / max(len(names), 1)] * len(names)
        for name, text in zip(names, outs):
            texts[name][key] = text
        print(f"{key} {sec:.1f}s rss={rss}MB", flush=True)

    # 集計: 後処理なし（old）/ あり（new）、読み直し（しきい値ごと）
    table: dict[str, list[float]] = {}

    def add(key: str, value: float) -> None:
        table.setdefault(key, []).append(value)

    for name in names:
        gt = rows[name]["gt"]
        for key, text in texts[name].items():
            add(f"{key} (後処理なし)", cer(gt, text))
            add(key, cer(gt, clean_ocr_text(text)))
        base = texts[name].get("tess-color")
        for preset in presets if base is not None else []:
            alt = texts[name][f"paddle-{preset}"]
            # 品質の低いページだけ読み直す（最初の案。品質スコアで見分けられず効かなかった）
            use_alt = text_quality(base) < 0.85 and text_quality(alt) > text_quality(base)
            add(f"読み直し {preset}（品質0.85未満だけ）", cer(gt, clean_ocr_text(alt if use_alt else base)))
            # 本番: PaddleOCR を使い、読めていなさそうなら Tesseract（paddle_ocr.choose_text）
            add(f"本番 {preset}（だめなら Tesseract）", cer(gt, clean_ocr_text(choose_text(base, alt)[0])))
        rows[name]["quality"] = {k: text_quality(t) for k, t in texts[name].items()}

    lines = ["| 方式 | CER 平均 | CER 中央値 | 1ページの秒数 |", "|---|---|---|---|"]
    for key, vals in sorted(table.items(), key=lambda kv: statistics.mean(kv[1])):
        base_key = key.split(" (")[0]
        sec = statistics.mean(times[base_key]) if base_key in times else None
        lines.append(f"| {key} | {statistics.mean(vals):.3f} | {statistics.median(vals):.3f} | "
                     f"{'' if sec is None else f'{sec:.1f}'} |")
    lines.append("")
    lines.append("読み直しの最大メモリ: " + ", ".join(f"{k} {v}MB" for k, v in mem.items()))
    report = "\n".join(lines)
    print(report)
    (out / "report.md").write_text(report + "\n", encoding="utf-8")
    (out / "texts.json").write_text(json.dumps({"rows": rows, "texts": texts}, ensure_ascii=False, indent=1),
                                    encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("synth")
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--n", type=int, default=12)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--font", action="append", default=None,
                   help="CJK フォント（複数可）。既定は Noto Sans/Serif CJK")
    r = sub.add_parser("run")
    r.add_argument("--samples", type=Path, required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--preset", action="append", default=None, help="paddle_ocr のモデル（複数可）")
    r.add_argument("--max-side", type=int, default=1600)
    r.add_argument("--variant", action="append", default=None, help="Tesseract の方式（複数可）")
    r.add_argument("--no-paddle", action="store_true", help="PaddleOCR を測らない")
    args = ap.parse_args()
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if args.cmd == "synth":
        fonts = args.font or [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
        ]
        synth(args.out, args.n, args.seed, fonts)
    else:
        from app.services.paddle_ocr import PRESETS

        presets = [] if args.no_paddle else (args.preset or list(PRESETS))
        run(args.samples, args.out, presets, args.max_side, args.variant or list(TESS_VARIANTS))


if __name__ == "__main__":
    main()
