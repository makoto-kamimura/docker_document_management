"""撮影した書類の本文を PaddleOCR（PP-OCR を RapidOCR / ONNX Runtime で実行）で読む。

合成サンプルの評価（scripts/ocr_eval.py）で、PP-OCRv6 small は Tesseract（tessdata_best）より
文字誤り率が約3分の1で、速さは約6倍だった。そこで画像のページの本文（検索・解析・タイトルに使う
`documents.ocr_text`）はこちらで読み、Tesseract は検索可能 PDF のテキスト層だけに使う。
読めなかったページは Tesseract の結果を使う（`choose_text`）。

メモリを使うので**別プロセス**で動かし、読み終わればメモリを返す:

    python -m app.services.paddle_ocr IMAGE [IMAGE ...]   # 標準出力に JSON（ページごとの文字列）

モデルはワーカーのイメージにビルド時に焼き込む（`PADDLE_OCR_MODEL_DIR`）。実行時には取りに行かない。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

MODEL_DIR = os.environ.get("PADDLE_OCR_MODEL_DIR", "/opt/paddle-ocr")

# モデルの組み合わせ（評価スクリプトで比べて既定を決める。docs/design/plan-capture-viewer-account.md）
PRESETS: dict[str, dict] = {
    "v6-small": {"version": "PP-OCRv6", "det": "small", "rec": "small"},
    "v6-medium": {"version": "PP-OCRv6", "det": "medium", "rec": "medium"},
    "v5-server": {"version": "PP-OCRv5", "det": "server", "rec": "server"},
}
DEFAULT_PRESET = "v6-small"
# 長辺をこの大きさまで縮めてから読む。1600 で誤り率は 2000 と同じまま、メモリは約 570MB（2000 は約 750MB）
DEFAULT_MAX_SIDE = 1600


def _engine(preset: str, threads: int, max_side: int):
    from rapidocr import LangDet, LangRec, ModelType, OCRVersion, RapidOCR

    p = PRESETS[preset]
    version = OCRVersion(p["version"])
    params = {
        "Global.log_level": "warning",
        # 渡すのは台形補正済みで正立した画像なので、行の向き判定（別モデル）は使わない
        "Global.use_cls": False,
        "Global.max_side_len": max_side,
        "EngineConfig.onnxruntime.intra_op_num_threads": threads,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "Det.ocr_version": version,
        "Det.model_type": ModelType(p["det"]),
        "Rec.ocr_version": version,
        "Rec.model_type": ModelType(p["rec"]),
        "Rec.lang_type": LangRec.JAPAN if version == OCRVersion.PPOCRV6 else LangRec.CH,
        "Det.lang_type": LangDet.CH,
    }
    # 焼き込んだモデルがあればそれを使う（無ければ RapidOCR が既定の場所から読む＝評価用）
    det = os.path.join(MODEL_DIR, f"{preset}-det.onnx")
    rec = os.path.join(MODEL_DIR, f"{preset}-rec.onnx")
    if os.path.exists(det) and os.path.exists(rec):
        params["Det.model_path"] = det
        params["Rec.model_path"] = rec
    return RapidOCR(params=params)


def assemble_text(boxes, txts, scores=None, min_score: float = 0.5) -> str:
    """検出した文字の枠を、読む順番に並べて文章にする。

    - 縦長の枠が多いページは縦書きとみなし、列を右から左、列の中を上から下へ読む
      （座標の縦横を入れ替えて、横書きと同じ処理にかける）。
    - 横書きは、同じ行の枠をまとめ、上の行から、行の中は左から読む。
      行の間が大きく空いたところには空行を入れる（段落の区切り）。
    """
    items = []
    for i, (box, txt) in enumerate(zip(boxes, txts)):
        if not txt or not str(txt).strip():
            continue
        if scores is not None and scores[i] < min_score:
            continue
        pts = [(float(p[0]), float(p[1])) for p in box]
        xs = [x for x, _ in pts]
        ys = [y for _, y in pts]
        items.append({"t": str(txt).strip(), "pts": pts, "w": max(xs) - min(xs), "h": max(ys) - min(ys)})
    if not items:
        return ""

    tall = sum(1 for it in items if it["h"] > 1.5 * it["w"] and len(it["t"]) >= 2)
    wide = sum(1 for it in items if it["w"] > 1.5 * it["h"] and len(it["t"]) >= 2)
    if tall > wide:
        # 縦書き: (x, y) → (y, x) にすると、列が「行」になる。列は右から読むので並びを逆にする
        for it in items:
            it["pts"] = [(y, x) for x, y in it["pts"]]
        return _join_lines(items, reverse=True)
    return _join_lines(items, reverse=False)


def _line_geometry(pts: list[tuple[float, float]]) -> dict:
    """枠の4隅から、行の左端の中心・傾き・文字の太さを求める（少し傾いた行にも対応）。"""
    by_x = sorted(pts)
    left = sorted(by_x[:2], key=lambda p: p[1])    # 左の2点（上・下）
    right = sorted(by_x[2:], key=lambda p: p[1])   # 右の2点（上・下）
    lx = (left[0][0] + left[1][0]) / 2
    ly = (left[0][1] + left[1][1]) / 2
    rx = (right[0][0] + right[1][0]) / 2
    ry = (right[0][1] + right[1][1]) / 2
    slope = (ry - ly) / (rx - lx) if rx - lx > 1 else 0.0
    thick = max(((left[1][1] - left[0][1]) + (right[1][1] - right[0][1])) / 2, 1.0)
    return {"lx": lx, "ly": ly, "slope": slope, "thick": thick}


def _join_lines(items: list[dict], reverse: bool) -> str:
    """同じ行の枠をまとめ、行の中は左から、行は上から（reverse なら下から）並べて連結する。

    同じ行かどうかは、行の傾きを延ばした位置と枠の左端の中心との距離（文字の太さの半分以内）
    で決める。外接矩形の重なりで決めると、少し傾いた長い行が隣の行を取り込んでしまう。
    """
    for it in items:
        it.update(_line_geometry(it["pts"]))

    groups: list[dict] = []
    for it in sorted(items, key=lambda it: it["ly"], reverse=reverse):
        best, best_d = None, None
        for g in groups:
            ref = g["ref"]
            expected = ref["ly"] + ref["slope"] * (it["lx"] - ref["lx"])
            d = abs(it["ly"] - expected)
            if d <= 0.5 * min(ref["thick"], it["thick"]) and (best_d is None or d < best_d):
                best, best_d = g, d
        if best is None:
            groups.append({"ref": it, "items": [it]})
        else:
            best["items"].append(it)
            if it["w"] > best["ref"]["w"]:
                best["ref"] = it  # 長い枠ほど傾きが正確

    def level(g: dict) -> float:
        ref = g["ref"]
        return ref["ly"] + ref["slope"] * (0 - ref["lx"])  # 左端（x=0）での行の位置

    groups.sort(key=level, reverse=reverse)
    thicks = sorted(g["ref"]["thick"] for g in groups)
    typical = thicks[len(thicks) // 2]

    lines, prev = [], None
    for g in groups:
        text = " ".join(it["t"] for it in sorted(g["items"], key=lambda it: it["lx"]))
        if prev is not None and abs(level(g) - level(prev)) > 2.3 * typical:
            lines.append("")  # 段落の区切り（行の間隔がふだんより大きい）
        lines.append(text)
        prev = g
    return "\n".join(lines)


def read_images(paths: list[str], preset: str = DEFAULT_PRESET, threads: int = 2,
                max_side: int = DEFAULT_MAX_SIDE) -> list[str]:
    """（子プロセス側）画像を読んで、ページごとの文字列を返す。"""
    engine = _engine(preset, threads, max_side)
    out = []
    for path in paths:
        res = engine(path)
        if res.boxes is None or res.txts is None:
            out.append("")
            continue
        out.append(assemble_text(res.boxes, res.txts, res.scores))
    return out


def run(images: list[bytes], preset: str = DEFAULT_PRESET, threads: int = 2,
        timeout_per_page: float = 60.0, max_side: int = DEFAULT_MAX_SIDE) -> list[str] | None:
    """（ワーカー側）別プロセスで読む。失敗・時間切れは None（Tesseract の結果を使う）。"""
    if not images:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, data in enumerate(images):
            p = os.path.join(tmp, f"page_{i:03d}.jpg")
            with open(p, "wb") as f:
                f.write(data)
            paths.append(p)
        cmd = [sys.executable, "-m", "app.services.paddle_ocr", "--preset", preset,
               "--threads", str(threads), "--max-side", str(max_side), *paths]
        try:
            res = subprocess.run(
                cmd, capture_output=True, timeout=timeout_per_page * len(paths) + 30, check=True,
            )
            texts = json.loads(res.stdout.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - 失敗しても Tesseract の結果があるので止めない
            print(f"[paddle_ocr] failed: {type(exc).__name__}: {exc}")
            return None
    if not isinstance(texts, list) or len(texts) != len(images):
        return None
    return [str(t) for t in texts]


def choose_text(tesseract: str, paddle: str | None) -> tuple[str, str]:
    """1ページの本文を決める。PaddleOCR を使い、読めていなさそうなときだけ Tesseract に戻す。

    文字の品質スコア（ocr_text.text_quality）は、誤り率 30% の読み取りでもほぼ満点になり、
    どちらが正しいかの判定には使えなかった（評価の結果）。なので「PaddleOCR が明らかに読めて
    いない」ときだけを見る: 文字数が Tesseract の半分未満か、品質スコアが大きく下回るとき。
    戻り値は (本文, 使ったエンジン)。
    """
    from app.services.ocr_text import text_quality

    if paddle is None:
        return tesseract, "tesseract"
    p_len = len("".join(paddle.split()))
    t_len = len("".join(tesseract.split()))
    if p_len == 0 or p_len < 0.5 * t_len:
        return tesseract, "tesseract"
    if text_quality(paddle) < text_quality(tesseract) - 0.2:
        return tesseract, "tesseract"
    return paddle, "paddle"


def _main(argv: list[str]) -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", default=DEFAULT_PRESET, choices=sorted(PRESETS))
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--max-side", type=int, default=DEFAULT_MAX_SIDE)
    ap.add_argument("images", nargs="+")
    args = ap.parse_args(argv)
    texts = read_images(args.images, args.preset, args.threads, args.max_side)
    sys.stdout.write(json.dumps(texts, ensure_ascii=False))


if __name__ == "__main__":
    _main(sys.argv[1:])
