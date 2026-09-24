"""要約PDF生成サービス。

OCRテキストの要約を、日本語対応のPDF（電子資料）として出力する。
reportlab の内蔵CIDフォント (HeiseiKakuGo-W5) を使うため外部フォント不要で
日本語を埋め込める。
"""

import os
import re
import tempfile
from datetime import datetime
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

_FONT = "HeiseiKakuGo-W5"
_font_registered = False


def _ensure_font() -> None:
    global _font_registered
    if not _font_registered:
        pdfmetrics.registerFont(UnicodeCIDFont(_FONT))
        _font_registered = True


def _escape(text: str) -> str:
    """Paragraph 用に最小限のエスケープと改行変換を行う。"""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return text.replace("\n", "<br/>")


def build_summary_pdf(title: str, summary: str) -> bytes:
    """タイトル見出し + 要約本文のPDFをバイト列で返す。"""
    _ensure_font()

    base = getSampleStyleSheet()["Normal"]
    title_style = ParagraphStyle(
        "DmsTitle", parent=base, fontName=_FONT, fontSize=16, leading=22, spaceAfter=6
    )
    meta_style = ParagraphStyle(
        "DmsMeta", parent=base, fontName=_FONT, fontSize=9, leading=13, textColor="#64748b"
    )
    body_style = ParagraphStyle(
        "DmsBody", parent=base, fontName=_FONT, fontSize=11, leading=18
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=title,
    )

    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    body = summary.strip() or "（要約を生成できませんでした）"

    story = [
        Paragraph(_escape(title or "（無題）"), title_style),
        Paragraph(f"要約電子資料 / 生成日時: {generated}", meta_style),
        Spacer(1, 8 * mm),
        Paragraph(_escape(body), body_style),
    ]
    doc.build(story)
    return buf.getvalue()


# OCR 精度を上げる強化オプション（環境により未対応なら自動フォールバック）。
# deskew=傾き補正 / rotate_pages=向き自動補正(osd) / pagesegmode=3 は全自動レイアウト解析。
# plugins で OCR 用画像だけに影・照明ムラ除去と低解像度時の拡大をかける (ocr_plugin)。
# - tesseract_oem は指定しない（学習データは LSTM のみで既定でも LSTM が使われる。oem=1 を
#   強制すると LSTM を持たない osd での向き判定がエラーになる）。
# - clean(unpaper) は使わない（上記の前処理で不要になり、精度は同じまま処理時間が約2割増えるため）。
_OCR_ENHANCED = dict(
    deskew=True,
    rotate_pages=True,
    tesseract_pagesegmode=3,
    plugins=["app.services.ocr_plugin"],
)


def _run_ocr(src: str, out: str, lang: str, sidecar: str, base: dict) -> None:
    """ocrmypdf を強化オプションで実行し、失敗時は素のオプションへフォールバックする。"""
    import ocrmypdf

    common = dict(language=lang, progress_bar=False, sidecar=sidecar, **base)
    try:
        ocrmypdf.ocr(src, out, **_OCR_ENHANCED, **common)
        return
    except Exception as exc:  # noqa: BLE001 - 強化オプション未対応環境などでの保険
        print(f"[pdf_export] enhanced OCR failed, fallback to basic: "
              f"{type(exc).__name__}: {exc}")
    ocrmypdf.ocr(src, out, **common)


def build_ocr_text_pdf(title: str, text: str) -> bytes:
    """OCRで認識した文字を集約した電子資料PDFを生成する (F-13/F-14系)。

    要約ではなく**OCR抽出テキストの全文**を、日本語対応フォントで段落ごとに流し込み、
    長文は自動的に複数ページへ分割する。
    """
    _ensure_font()

    base = getSampleStyleSheet()["Normal"]
    title_style = ParagraphStyle(
        "OcrTitle", parent=base, fontName=_FONT, fontSize=16, leading=22, spaceAfter=6
    )
    meta_style = ParagraphStyle(
        "OcrMeta", parent=base, fontName=_FONT, fontSize=9, leading=13, textColor="#64748b"
    )
    body_style = ParagraphStyle(
        "OcrBody", parent=base, fontName=_FONT, fontSize=10.5, leading=17, spaceAfter=6
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=18 * mm,
        title=title,
    )

    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    story = [
        Paragraph(_escape(title or "（無題）"), title_style),
        Paragraph(f"OCR抽出テキスト（全文） / 生成日時: {generated}", meta_style),
        Spacer(1, 8 * mm),
    ]

    body = (text or "").strip()
    if not body:
        story.append(Paragraph("（OCRテキストがありません）", body_style))
    else:
        # 空行で段落分割。各段落を Paragraph 化することで自動ページ送りされる。
        for para in re.split(r"\n\s*\n", body):
            para = para.strip()
            if para:
                story.append(Paragraph(_escape(para), body_style))
    doc.build(story)
    return buf.getvalue()


def build_searchable_pdf(image_bytes: bytes, lang: str = "jpn+eng", dpi: int = 300) -> bytes:
    """撮影画像（1枚）から検索可能PDFを生成する (F-14)。"""
    pdf, _ = build_searchable_pdf_from_images([image_bytes], lang, dpi)
    return pdf


def build_searchable_pdf_from_images(
    images: list[bytes], lang: str = "jpn+eng", dpi: int = 300
) -> tuple[bytes, str]:
    """複数ページ画像を1つの検索可能PDFに統合する (F-12/F-14)。

    img2pdf で画像を1つのPDFに束ね、ocrmypdf で透明テキスト層を付与する。
    戻り値は (PDFバイト, OCRテキスト)。OCRテキストは sidecar から取得する。
    """
    import img2pdf

    with tempfile.TemporaryDirectory() as tmp:
        img_paths = []
        for i, data in enumerate(images):
            p = os.path.join(tmp, f"page_{i:03d}.img")
            with open(p, "wb") as f:
                f.write(data)
            img_paths.append(p)

        merged = os.path.join(tmp, "merged.pdf")
        with open(merged, "wb") as f:
            f.write(img2pdf.convert(img_paths, dpi=dpi))

        out = os.path.join(tmp, "output.pdf")
        sidecar = os.path.join(tmp, "ocr.txt")
        _run_ocr(merged, out, lang, sidecar, base=dict(force_ocr=True, output_type="pdf"))
        with open(out, "rb") as f:
            pdf_bytes = f.read()
        text = ""
        if os.path.exists(sidecar):
            with open(sidecar, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        return pdf_bytes, text


def build_searchable_pdf_from_pdf(pdf_bytes: bytes, lang: str = "jpn+eng") -> tuple[bytes, str]:
    """既存PDFを検索可能PDF化する (F-10/F-14)。戻り値は (PDFバイト, OCRテキスト)。"""
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "input.pdf")
        out = os.path.join(tmp, "output.pdf")
        sidecar = os.path.join(tmp, "ocr.txt")
        with open(src, "wb") as f:
            f.write(pdf_bytes)
        # 既にテキスト層があるページはそのまま、画像ページのみOCRする
        _run_ocr(src, out, lang, sidecar, base=dict(skip_text=True))
        with open(out, "rb") as f:
            pdf_out = f.read()
        text = ""
        if os.path.exists(sidecar):
            with open(sidecar, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        return pdf_out, text
