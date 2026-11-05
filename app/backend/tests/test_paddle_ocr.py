"""PaddleOCR での本文の読み取り: 枠を読む順に並べる処理と、ページごとの選び方。"""

from app.core.config import settings
from app.services import paddle_ocr
from app.services.paddle_ocr import assemble_text, choose_text
from app.workers import ocr_worker


def _box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def test_horizontal_lines_top_to_bottom_left_to_right():
    boxes = [_box(300, 100, 600, 140), _box(100, 102, 280, 140), _box(100, 160, 500, 200),
             _box(100, 400, 500, 440)]  # 最後は段落が変わる（行間が大きい）
    txts = ["のお知らせ", "運動会", "十月十日に開催します。", "雨天は延期します。"]
    assert assemble_text(boxes, txts) == "運動会 のお知らせ\n十月十日に開催します。\n\n雨天は延期します。"


def test_vertical_columns_right_to_left():
    boxes = [_box(180, 100, 220, 600), _box(300, 100, 340, 500), _box(240, 100, 280, 700)]
    txts = ["三列目", "一列目です", "二列目です"]
    assert assemble_text(boxes, txts).split("\n") == ["一列目です", "二列目です", "三列目"]


def test_low_score_and_empty_boxes_are_dropped():
    boxes = [_box(0, 0, 100, 30), _box(0, 40, 100, 70), _box(0, 80, 100, 110)]
    assert assemble_text(boxes, ["よい", "", "ざつおん"], [0.9, 0.9, 0.2]) == "よい"


TESS = "運動会のお知らせ\n秋季運動合を十月十日に開催します。\nお弁当と水筒をご用意ください。"
PADDLE = "運動会のお知らせ\n秋季運動会を十月十日に開催します。\nお弁当と水筒をご用意ください。"


def test_choose_text_prefers_paddle_unless_it_clearly_failed():
    assert choose_text(TESS, PADDLE) == (PADDLE, "paddle")
    assert choose_text(TESS, None) == (TESS, "tesseract")          # 別プロセスが失敗
    assert choose_text(TESS, "") == (TESS, "tesseract")            # 何も読めなかった
    assert choose_text(TESS, "運動会") == (TESS, "tesseract")      # 文字数が半分未満
    assert choose_text(TESS, "~|; ‘ i\n#\n. ,\n=|\n” %% ¥\ni l") == (TESS, "tesseract")  # 記号の羅列
    assert choose_text("", PADDLE) == (PADDLE, "paddle")            # Tesseract が読めなかったページ


def test_paddle_pages_per_page(monkeypatch):
    calls = []

    def fake_run(images, preset, max_side):
        calls.append((len(images), preset, max_side))
        return [PADDLE, ""]

    monkeypatch.setattr(paddle_ocr, "run", fake_run)
    monkeypatch.setattr(settings, "ocr_text_engine", "paddle")
    text, engines = ocr_worker._paddle_pages(f"{TESS}\f{TESS}\f", [b"p1", b"p2"])
    assert calls == [(2, settings.ocr_paddle_preset, settings.ocr_paddle_max_side)]
    assert engines == ["paddle", "tesseract"]  # 2ページ目は PaddleOCR が読めなかったので Tesseract
    assert text.split("\f") == [PADDLE, TESS]


def test_paddle_pages_keeps_tesseract_when_off_or_failed(monkeypatch):
    monkeypatch.setattr(settings, "ocr_text_engine", "tesseract")
    assert ocr_worker._paddle_pages(TESS, [b"p"]) == (TESS, ["tesseract"])
    monkeypatch.setattr(settings, "ocr_text_engine", "paddle")
    monkeypatch.setattr(paddle_ocr, "run", lambda images, preset, max_side: None)  # 別プロセスが失敗
    assert ocr_worker._paddle_pages(TESS, [b"p"]) == (TESS, ["tesseract"])


def test_tilted_neighbouring_lines_stay_apart():
    # 少し傾いた2行（左が上がり、右が下がる）。行の範囲を広げていくと1行にまとまってしまう例
    boxes = [_box(100, 100, 400, 140), _box(420, 118, 900, 158),   # 1行目（右へ下がる）
             _box(100, 150, 380, 190), _box(400, 168, 700, 208)]   # 2行目
    txts = ["一行目の前半", "一行目の後半", "二行目の前半", "二行目の後半"]
    assert assemble_text(boxes, txts).split("\n") == ["一行目の前半 一行目の後半", "二行目の前半 二行目の後半"]


def test_rotated_quads_of_a_slanted_page():
    # 傾いたページ: 長い行の外接矩形は縦に太くなり、隣の行と重なる（実際の検出結果に近い座標）
    def quad(x0, y0, x1, y1, drop):
        return [[x0, y0], [x1, y0 + drop], [x1, y1 + drop], [x0, y1]]
    boxes = [quad(522, 680, 2523, 760, 79), quad(522, 758, 1767, 838, 37),
             quad(522, 857, 2519, 937, 73), quad(520, 934, 1240, 1014, 14)]
    txts = ["二行目", "三行目", "四行目", "五行目"]
    assert assemble_text(boxes, txts).split("\n") == txts
