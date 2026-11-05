"""白黒モードの PDF: 画像だけを白黒にし、大きさ（＝テキスト層の位置）は変えない。"""

from io import BytesIO

import img2pdf
import numpy as np
import pikepdf
from PIL import Image
from pikepdf import PdfImage

from app.services import image_processing, pdf_export


def test_binarize_pdf_images_keeps_size_and_makes_black_and_white():
    gray = np.tile(np.linspace(40, 230, 300, dtype=np.uint8), (200, 1))
    gray[98:102, 50:250] = 20  # 文字の線に見立てた細い黒い帯（適応的二値化は太い塗りの内側を白くする）
    buf = BytesIO()
    Image.fromarray(gray).save(buf, format="JPEG")
    pdf = img2pdf.convert(buf.getvalue())

    out = pdf_export.binarize_pdf_images(pdf, image_processing.binarize)

    with pikepdf.open(BytesIO(out)) as doc:
        (raw,) = doc.pages[0].images.values()
        img = np.asarray(PdfImage(raw).as_pil_image().convert("L"))
    assert img.shape == gray.shape
    assert set(np.unique(img)) <= {0, 255}
    assert img[100, 150] == 0  # 線は黒のまま
