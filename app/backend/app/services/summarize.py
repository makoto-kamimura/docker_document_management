"""要約サービス。

OCR抽出テキストを要約する。優先順位は Dify > kuromoji頻度ベース抽出要約 > ルールベース。
`settings.dify_api_key` が設定されていれば Dify(完了/ワークフローアプリ) のAPIを呼ぶ。
未設定/失敗時は kuromoji 形態素解析（OpenSearch _analyze）による抽出型要約を行い、
それも不達なら先頭数文のルールベースへフォールバックする。
"""

import re
import unicodedata

import httpx

from app.core.config import settings

_TIMEOUT = 60.0


def clean_ocr_text(text: str | None) -> str:
    """OCR抽出テキストのノイズを整理する（検索/要約の前処理）。

    NFKC正規化、日本語文字間に紛れ込む空白の除去、連続する空白・改行の圧縮を行う。
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    # 全角化された記号を戻しすぎないよう最小限。CJK文字に挟まれた空白を除去
    cjk = r"぀-ヿ㐀-䶿一-鿿＀-￯"
    text = re.sub(rf"(?<=[{cjk}])[ \t　]+(?=[{cjk}])", "", text)
    text = re.sub(r"[ \t　]+", " ", text)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def summarize(text: str | None) -> str:
    """テキストを要約して返す。空入力なら空文字。"""
    cleaned = clean_ocr_text(text)
    if not cleaned:
        return ""
    snippet = cleaned[: settings.summary_max_chars]

    if settings.dify_api_key:
        try:
            return _summarize_with_dify(snippet)
        except Exception as exc:  # noqa: BLE001 - フォールバックして継続
            print(f"[summarize] Dify 失敗のためフォールバック: {type(exc).__name__}: {exc}")

    # kuromoji 頻度ベースの抽出要約 → 失敗時ルールベース
    extractive = _extractive_summary(snippet)
    return extractive or _rule_based_summary(snippet)


def _summarize_with_dify(text: str) -> str:
    """Dify アプリのAPIで要約する。app_type に応じてエンドポイントを切替。"""
    base = settings.dify_api_base.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.dify_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "inputs": {settings.dify_input_var: text},
        "response_mode": "blocking",
        "user": "dms-backend",
    }

    if settings.dify_app_type == "workflow":
        url = f"{base}/workflows/run"
    else:
        # completion アプリ。query は inputs と別に必須なため要約対象を渡す。
        url = f"{base}/completion-messages"
        payload["query"] = text

    with httpx.Client(timeout=_TIMEOUT) as client:
        res = client.post(url, headers=headers, json=payload)
        res.raise_for_status()
        data = res.json()

    if settings.dify_app_type == "workflow":
        outputs = (data.get("data") or {}).get("outputs") or {}
        result = outputs.get(settings.dify_output_var) or next(
            (v for v in outputs.values() if isinstance(v, str) and v.strip()), ""
        )
    else:
        result = data.get("answer", "")

    result = (result or "").strip()
    return result or _rule_based_summary(text)


_SENT_SPLIT = re.compile(r"(?<=[。．.!?！？\n])")

# 要約のスコアリングから除外するストップワード相当（助詞・記号・汎用語）
_STOPWORDS = {
    "こと", "もの", "これ", "それ", "ため", "よう", "など", "および", "また",
    "する", "なる", "ある", "いる", "れる", "られる", "の", "は", "が", "を",
    "に", "へ", "と", "で", "も", "や", "から", "まで", "より",
}


def _split_sentences_with_spans(text: str) -> list[tuple[str, int, int]]:
    """文に分割し (文, 開始offset, 終了offset) を返す。"""
    out: list[tuple[str, int, int]] = []
    pos = 0
    for part in _SENT_SPLIT.split(text):
        if not part:
            continue
        start = pos
        end = pos + len(part)
        pos = end
        if part.strip():
            out.append((part.strip(), start, end))
    return out


def _kuromoji_tokens(text: str) -> list[tuple[str, int]]:
    """OpenSearch(kuromoji) で全文を1回トークン化し (token, start_offset) を返す。"""
    from app.services import search as search_service

    res = search_service.client().indices.analyze(
        index=settings.search_index,
        body={"analyzer": "ja_analyzer", "text": text},
    )
    toks = []
    for t in res.get("tokens", []):
        token = t.get("token", "")
        if len(token) >= 2 and token not in _STOPWORDS and not token.isdigit():
            toks.append((token, t.get("start_offset", 0)))
    return toks


def _extractive_summary(text: str, max_sentences: int = 5) -> str:
    """kuromoji 頻度ベースの抽出型要約。

    全文をトークン化して語の出現頻度を求め、各文を「含有語の頻度和 / √(文長)」でスコア化、
    上位文を**原文の順序**で連結する。OpenSearch 不達や短文時は空文字を返し呼び出し側で
    ルールベースへフォールバックする。
    """
    sentences = _split_sentences_with_spans(text)
    if len(sentences) <= max_sentences:
        return ""  # 短いので抽出の意味がない→フォールバック

    try:
        tokens = _kuromoji_tokens(text)
    except Exception as exc:  # noqa: BLE001
        print(f"[summarize] kuromoji 解析失敗: {type(exc).__name__}: {exc}")
        return ""
    if not tokens:
        return ""

    # 語の出現頻度
    freq: dict[str, int] = {}
    for tok, _ in tokens:
        freq[tok] = freq.get(tok, 0) + 1

    # トークンを文へ割り当て、文スコアを算出
    import bisect

    starts = [s[1] for s in sentences]
    scores = [0.0] * len(sentences)
    for tok, off in tokens:
        idx = bisect.bisect_right(starts, off) - 1
        if 0 <= idx < len(sentences):
            scores[idx] += freq[tok]
    for i, (sent, _, _) in enumerate(sentences):
        scores[i] /= max(len(sent), 1) ** 0.5

    # 上位文を選び、原文順に連結（上限文字数まで）
    ranked = sorted(range(len(sentences)), key=lambda i: scores[i], reverse=True)
    chosen = sorted(ranked[:max_sentences])
    limit = min(settings.summary_max_chars, 600)
    out, total = [], 0
    for i in chosen:
        s = sentences[i][0]
        if total + len(s) > limit and out:
            break
        out.append(s)
        total += len(s)
    return "".join(out).strip()


def _rule_based_summary(text: str, max_sentences: int = 5) -> str:
    """外部API不要の簡易抽出要約。先頭の数文を上限文字数まで連結する。"""
    sentences = [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]
    out: list[str] = []
    total = 0
    limit = min(settings.summary_max_chars, 600)
    for s in sentences[:max_sentences]:
        if total + len(s) > limit and out:
            break
        out.append(s)
        total += len(s)
    summary = "".join(out).strip()
    if not summary:
        summary = text[:limit]
    return summary
