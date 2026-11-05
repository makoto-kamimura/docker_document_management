"""OCR テキストの後処理（カタカナの誤認識補正）と品質判定。"""

import pytest

from app.services.ocr_text import clean_ocr_text, fix_katakana_lookalikes, text_quality


@pytest.mark.parametrize("src, want", [
    ("メ一ル", "メール"),
    ("コ一ヒ一", "コーヒー"),            # 語末の長音も
    ("プ口グラム", "プログラム"),
    ("ア力ウント", "アカウント"),
    ("エレベ一タ一", "エレベーター"),
    ("メ一ルボ一ド", "メールボード"),     # 続けて何か所あっても
    ("ス夕ンプ", "スタンプ"),
    ("テキスト", "テキスト"),            # 変える所がなければそのまま
    ("ー日三回", "一日三回"),            # 逆向き: 行頭の長音は漢数字の一
    ("錠\nー回一錠", "錠\n一回一錠"),
    ("毎食後ー回", "毎食後一回"),
])
def test_fixes_lookalikes_inside_katakana(src, want):
    assert fix_katakana_lookalikes(src) == want


@pytest.mark.parametrize("src", [
    "入口", "協力", "一月", "二人", "八百屋", "工事", "夕方",
    "ページ一覧",   # カタカナの後ろでも漢字が続けば漢数字のまま
    "ゲーム一つ",
    "テスト1回目",
    "ラーメン", "コーヒー豆", "ミリグラム", "まーるい",
])
def test_keeps_ordinary_kanji(src):
    assert fix_katakana_lookalikes(src) == src


def test_clean_ocr_text():
    raw = "運 動 会 の お 知 ら せ\n\n\n\nメ一ルで 連絡\fページ２"
    assert clean_ocr_text(raw) == "運動会のお知らせ\n\nメールで連絡\n\nページ2"
    assert clean_ocr_text(None) == ""


def test_text_quality_prefers_readable_text():
    good = "運動会のお知らせ\n秋季運動会を十月十日に開催します。\nお弁当と水筒をご用意ください。"
    broken = "~|; ‘ i\n#\n. ,\n=|\n” %% ¥\ni l\n|‖"
    assert text_quality(good) > 0.8
    assert text_quality(broken) < 0.5
    assert text_quality("") == 0.0
    assert text_quality("あ") == 0.0  # ほとんど文字が無い
