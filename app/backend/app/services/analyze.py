"""OCR テキストの文書解析（家庭向け: 重要度・期限・対象・キーワードの判定）。

家に届いた紙（学校のプリント、請求書、役所の通知など）を想定し、ルールベースで
- 重要度: high / normal / low
- 期限: 「9月30日までに」「提出期限 令和8年9月30日」などの締切日
- 行事日: 「10月5日(日) 開催」などの日付
- 対象: 「保護者の方へ」「山田太郎 様」など
- キーワード: 提出・支払い・申込 など、家族が取るべき行動
- 分類: 学校 / 行政 / 支払い・請求 など
- タイトル候補: 自動命名（資料_123…）を置き換える見出し
を抽出する。外部サービスに本文を送らない（家庭の書類のため）。
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, timedelta

IMPORTANCE_HIGH = "high"
IMPORTANCE_NORMAL = "normal"
IMPORTANCE_LOW = "low"

# 自動命名されたタイトル（モバイルの撮影/取込時）。解析結果の見出しで置き換えてよいもの
AUTO_TITLE_RE = re.compile(r"^(資料|取込)_\d+$")

# ---- 日付 ----

_KANJI_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
                 "六": 6, "七": 7, "八": 8, "九": 9}
_NUM = r"[0-9〇零一二三四五六七八九十元]{1,4}"


def _to_int(s: str) -> int | None:
    """アラビア数字/漢数字（十・元を含む）を整数にする。"""
    if s.isdigit():
        return int(s)
    if s == "元":
        return 1
    if "十" in s:
        head, _, tail = s.partition("十")
        tens = _KANJI_DIGITS.get(head, None) if head else 1
        ones = _KANJI_DIGITS.get(tail, None) if tail else 0
        if tens is None or ones is None:
            return None
        return tens * 10 + ones
    # 二〇二六 のような位取り
    try:
        return int("".join(str(_KANJI_DIGITS[c]) for c in s))
    except KeyError:
        return None


_ERA_BASE = {"令和": 2018, "平成": 1988}
_DATE_PATTERNS = [
    # 令和8年9月30日
    re.compile(rf"(?P<era>令和|平成)\s*(?P<y>{_NUM})\s*年\s*(?P<m>{_NUM})\s*月\s*(?P<d>{_NUM})\s*日"),
    # 2026年9月30日 / 2026/9/30 / 2026-09-30 / 2026.9.30
    re.compile(r"(?<!\d)(?P<y>20\d{2})\s*[年/.\-]\s*(?P<m>\d{1,2})\s*[月/.\-]\s*(?P<d>\d{1,2})(?!\d)"),
    # 9月30日 / 九月三十日
    re.compile(rf"(?<![0-9年/])(?P<m>{_NUM})\s*月\s*(?P<d>{_NUM})\s*日"),
    # 9/30（電話番号・分数と区別するため前後に数字や / が続かないもの）
    re.compile(r"(?<![\d/.\-])(?P<m>\d{1,2})/(?P<d>\d{1,2})(?![\d/])"),
]

# 期限を示す語（日付の直後/直前に現れる）
_DEADLINE_AFTER = re.compile(r"^[^\n。]{0,12}?(まで|迄|必着|締切|締め切り|〆切)")
_DEADLINE_BEFORE = re.compile(r"(期限|締切|締め切り|〆切|提出日|納期限|期日|支払期日|お支払日|振込期限|申込期限|回答期限)[^\n。]{0,12}$")
# 行事・開催日を示す語
_EVENT_NEAR = re.compile(r"(開催|実施|行います|行事|日時|日程|予定|集合|参観|説明会|運動会|発表会|懇談会|面談)")


@dataclass
class _Found:
    when: date
    start: int
    end: int


def _resolve(m: re.Match, ref: date) -> date | None:
    g = m.groupdict()
    mo, d = _to_int(g["m"]), _to_int(g["d"])
    if not mo or not d or not (1 <= mo <= 12 and 1 <= d <= 31):
        return None
    if g.get("era"):
        y = _to_int(g["y"])
        if y is None:
            return None
        year = _ERA_BASE[g["era"]] + y
    elif g.get("y"):
        year = int(g["y"])
    else:
        # 年の無い日付は「受け取り日から見て直近の将来」とみなす（1か月以上前なら翌年）
        year = ref.year
        try:
            if date(year, mo, d) < ref - timedelta(days=30):
                year += 1
        except ValueError:
            return None
    try:
        return date(year, mo, d)
    except ValueError:
        return None


def _find_dates(text: str, ref: date) -> list[_Found]:
    found: list[_Found] = []
    taken: list[tuple[int, int]] = []
    for pat in _DATE_PATTERNS:  # 具体的なパターンから順に。重なる短いものは捨てる
        for m in pat.finditer(text):
            if any(s < m.end() and m.start() < e for s, e in taken):
                continue
            when = _resolve(m, ref)
            if when is None:
                continue
            found.append(_Found(when, m.start(), m.end()))
            taken.append((m.start(), m.end()))
    return sorted(found, key=lambda f: f.start)


# ---- キーワード・重要度・対象・分類 ----

# 表示用ラベル → 本文中の表現
_ACTION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "提出": ("提出", "ご提出", "返送", "返信", "回答", "記入"),
    "支払い": ("支払", "お支払", "振込", "振り込", "納付", "引き落とし", "引落", "集金", "請求"),
    "申込": ("申込", "申し込", "応募", "予約", "エントリー"),
    "出欠": ("出欠", "出席", "欠席", "参加の有無"),
    "持ち物": ("持ち物", "持参", "ご用意"),
    "手続き": ("手続", "更新", "届出", "申請"),
    "イベント": ("開催", "行事", "運動会", "発表会", "説明会", "参観", "懇談会", "遠足", "祭"),
}
_STRONG_WORDS = ("重要", "至急", "必ず", "大切なお知らせ", "督促", "未納", "最終", "再通知",
                 "期限厳守", "緊急")
_PROMO_WORDS = ("セール", "キャンペーン", "特典", "クーポン", "広告", "新商品", "ポイント還元",
                "チラシ", "大売出し")

_AUDIENCES = ("保護者", "世帯主", "ご家族", "ご家庭", "児童", "生徒", "園児", "被保険者",
              "納税義務者", "契約者", "会員", "住民", "町内会員")
_ADDRESSEE_RE = re.compile(r"^\s*([^\s\d:：]{1,12}(?:\s[^\s\d:：]{1,8})?)\s*(様|殿)\s*$")

_CATEGORIES: list[tuple[str, tuple[str, ...]]] = [
    ("学校", ("学校", "小学校", "中学校", "高等学校", "保育園", "幼稚園", "こども園", "PTA",
             "学級", "担任", "校長", "園長", "学年", "児童", "生徒", "保護者")),
    ("支払い・請求", ("請求書", "御請求", "ご請求", "ご利用料金", "ご利用明細", "振込先",
                   "引き落とし", "口座振替", "納付書")),
    ("行政", ("市役所", "区役所", "町役場", "村役場", "市長", "区長", "税務署", "市民税",
             "住民税", "固定資産税", "年金", "マイナンバー", "保険料", "国民健康保険")),
    ("医療", ("病院", "クリニック", "医院", "健康診断", "健診", "予防接種", "検診", "診察")),
    ("地域", ("自治会", "町内会", "回覧", "管理組合", "マンション")),
    ("契約・保険", ("契約", "約款", "保険証券", "更新のご案内", "満期")),
]

_HEADING_HINT = re.compile(
    r"(お知らせ|ご案内|案内|通知|について|のお願い|お願い|便り|だより|通信)|(書|状|票|届)(\s|$)"
)


@dataclass
class Insight:
    importance: str = IMPORTANCE_NORMAL
    deadline: date | None = None
    event_date: date | None = None
    audience: str | None = None
    keywords: list[str] = field(default_factory=list)
    category: str | None = None
    title: str | None = None
    reasons: list[str] = field(default_factory=list)  # 判定理由（画面表示/デバッグ用）


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    # OCR が日本語の文字間に入れた空白は判定の邪魔になるので詰める（改行は残す）
    return re.sub(r"(?<=[^\x00-\x7F]) +(?=[^\x00-\x7F])", "", text)


def _suggest_title(lines: list[str], category: str | None) -> str | None:
    head = [ln.strip(" 　・-—【】[]") for ln in lines[:8] if ln.strip()]
    for ln in head:
        if 4 <= len(ln) <= 40 and _HEADING_HINT.search(ln) and not _ADDRESSEE_RE.match(ln):
            return ln
    if category:
        return f"{category}からのお知らせ"
    for ln in head:
        if 4 <= len(ln) <= 30:
            return ln
    return None


def analyze(text: str, ref: date | None = None) -> Insight:
    """OCR テキストを解析する。ref は年の無い日付を解決する基準日（受け取り日）。"""
    ref = ref or date.today()
    body = _normalize(text)
    ins = Insight()
    if not body.strip():
        return ins

    # 日付 → 期限 / 行事日
    deadlines: list[date] = []
    events: list[date] = []
    for f in _find_dates(body, ref):
        after = body[f.end:f.end + 16]
        before = body[max(0, f.start - 16):f.start]
        if _DEADLINE_AFTER.search(after) or _DEADLINE_BEFORE.search(before):
            deadlines.append(f.when)
        elif _EVENT_NEAR.search(before + after):
            events.append(f.when)
    upcoming = [d for d in deadlines if d >= ref - timedelta(days=1)]
    if upcoming or deadlines:
        ins.deadline = min(upcoming or deadlines)
        ins.reasons.append("期限の記載あり")
    if events:
        future = [d for d in events if d >= ref - timedelta(days=1)]
        ins.event_date = min(future or events)

    # 行動キーワード
    for label, words in _ACTION_KEYWORDS.items():
        if any(w in body for w in words):
            ins.keywords.append(label)

    # 対象
    lines = body.splitlines()
    for ln in lines[:6]:
        m = _ADDRESSEE_RE.match(ln)
        if m:
            ins.audience = f"{m.group(1)} {m.group(2)}"
            break
    if ins.audience is None:
        for a in _AUDIENCES:
            if a in body:
                ins.audience = a
                break

    # 分類（一番多く当たったもの）
    best, best_hits = None, 0
    for label, words in _CATEGORIES:
        hits = sum(body.count(w) for w in words)
        if hits > best_hits:
            best, best_hits = label, hits
    ins.category = best

    # 重要度
    strong = [w for w in _STRONG_WORDS if w in body]
    if strong:
        ins.keywords.insert(0, "重要")
        ins.reasons.append("「" + "・".join(strong[:3]) + "」の記載")
    needs_action = any(k in ins.keywords for k in ("提出", "支払い", "申込", "手続き"))
    if strong or (ins.deadline and needs_action):
        ins.importance = IMPORTANCE_HIGH
        if not strong:
            ins.reasons.append("期限つきの対応が必要")
    elif any(w in body for w in _PROMO_WORDS) and not ins.deadline:
        ins.importance = IMPORTANCE_LOW
        ins.reasons.append("広告・案内の可能性")

    ins.title = _suggest_title(lines, ins.category)
    return ins
