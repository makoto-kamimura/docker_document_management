"""OCR で読み取った文字の後処理と品質判定。

- `clean_ocr_text`: NFKC 正規化・日本語の間の空白除去・カタカナの誤認識補正。
  検索・解析・表示に使う `documents.ocr_text` はこれを通したもの。
- `text_quality`: 読み取り結果がどれだけ「文章らしい」かを 0〜1 で採点する。
  PaddleOCR が明らかに読めていないページ（記号の羅列）を見分けるのに使う（paddle_ocr.choose_text）。
  誤字の多い日本語らしい読み取りは見分けられない（scripts/ocr_eval.py の結果）ので、それ以上には使わない。
"""

from __future__ import annotations

import re
import unicodedata

_CJK = r"぀-ヿ㐀-䶿一-鿿＀-￯"

# カタカナに挟まれたときだけ置き換える「形の似た漢字」。Tesseract の日本語モデルは
# 長音「ー」を漢数字「一」に、「ロ」を「口」に読み違えやすい（例: メ一ル, プ口グラム）。
_KANA_LOOKALIKE = {
    "一": "ー",
    "口": "ロ",
    "力": "カ",
    "工": "エ",
    "夕": "タ",
    "二": "ニ",
    "八": "ハ",
    "卜": "ト",
}
_KATA = "ァ-ヺー"  # 全角カタカナと長音（中黒「・」は含めない）
_LOOKALIKE_RE = re.compile(
    rf"(?<=[{_KATA}])([{''.join(_KANA_LOOKALIKE)}])(?=[{_KATA}])"
)
# 語末の長音: 「コーヒ一」のようにカタカナの後ろで終わる「一」も長音にする。
# ただし後ろに漢字・数字・「つ」が続く場合（「ページ一覧」「ゲーム一つ」）は漢数字のまま。
_TAIL_CHOUON_RE = re.compile(rf"(?<=[{_KATA}])一(?![{_KATA}一-鿿0-9０-９つ])")
# 逆向きの誤り: 漢数字の「一」を長音「ー」と読む（行頭の「ー日三回」など）。長音はカタカナ・かなの
# 後ろにしか来ないので、そうでない位置で後ろに漢字が続く「ー」は「一」に戻す。
_KANJI_ONE_RE = re.compile(r"(?<![ァ-ヺーぁ-ゖ])ー(?=[㐀-䶿一-鿿])")


def fix_katakana_lookalikes(text: str) -> str:
    """カタカナに挟まれた形の似た漢字をカタカナへ戻す。

    前後が両方カタカナ（または長音）のときだけ置き換えるので、「入口」「協力」「一月」の
    ような普通の漢字の並びは変わらない。置き換えが連鎖する語（「メ一ルボ一ド」）にも
    効くよう、変化がなくなるまで繰り返す。
    """
    for _ in range(4):
        fixed = _LOOKALIKE_RE.sub(lambda m: _KANA_LOOKALIKE[m.group(1)], text)
        fixed = _TAIL_CHOUON_RE.sub("ー", fixed)
        fixed = _KANJI_ONE_RE.sub("一", fixed)
        if fixed == text:
            break
        text = fixed
    return text


def clean_ocr_text(text: str | None) -> str:
    """OCR抽出テキストのノイズを整理する。

    NFKC正規化、日本語文字間に紛れ込む空白の除去、カタカナの誤認識補正、
    連続する空白・改行の圧縮を行う。ページ区切り（\\f）は改行2つに置き換える。
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\f", "\n\n")
    # CJK文字に挟まれた空白を除去（Tesseract は日本語の文字の間に空白を入れがち）
    text = re.sub(rf"(?<=[{_CJK}])[ \t　]+(?=[{_CJK}])", "", text)
    text = fix_katakana_lookalikes(text)
    text = re.sub(r"[ \t　]+", " ", text)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# 文字（かな・漢字・英数字）。記号はふつうの文章でも1〜2割あるが、読み取りが崩れると大半が記号になる
_WORD_CHAR_RE = re.compile(r"[぀-ゟ゠-ヿ㐀-䶿一-鿿々〆ヵヶA-Za-z0-9]")


def text_quality(text: str | None) -> float:
    """読み取り結果の「文章らしさ」を 0〜1 で返す（高いほど良い）。

    見ているのは次の3つ。どれも正解テキストなしで計算できる。
    - 文字（かな・漢字・英数字）の割合。読めない箇所は記号の羅列になる。
    - 1〜2文字しかない行の割合。崩れた読み取りは細切れの行が増える。
    - ひらがなの割合。日本語の文章は助詞・送り仮名でひらがなが一定以上ある。
    文字がほとんど無いページは 0 を返す（読み直す価値がある）。
    """
    if not text:
        return 0.0
    body = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))
    if len(body) < 8:
        return 0.0

    word = len(_WORD_CHAR_RE.findall(body)) / len(body)
    word_score = min(word / 0.8, 1.0)

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    short = sum(1 for ln in lines if len(ln) <= 2) / len(lines) if lines else 1.0

    hira = len(re.findall(r"[぀-ゟ]", body)) / len(body)
    # 日本語の文書ではひらがなが2〜4割程度。英数字中心の書類もあるので減点は緩やかにする
    hira_score = min(hira / 0.15, 1.0)

    score = 0.6 * word_score + 0.25 * (1.0 - short) + 0.15 * hira_score
    return round(max(0.0, min(score, 1.0)), 4)
