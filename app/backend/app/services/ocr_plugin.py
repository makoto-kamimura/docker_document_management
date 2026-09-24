"""ocrmypdf プラグイン: OCR に渡す画像だけを前処理する (F-13/F-15)。

PDF に埋め込まれる表示用画像は変えずに、Tesseract が読む画像にだけ影・照明ムラの除去と
低解像度時の拡大をかける。拡大した分は DPI も上げ、テキスト層の位置（物理サイズ）を保つ。
`pdf_export._run_ocr` から `plugins=[__name__]` で読み込まれる。
"""

import numpy as np
from ocrmypdf import hookimpl
from PIL import Image

from app.services.image_processing import prepare_for_ocr


@hookimpl
def filter_ocr_image(page, image: Image.Image) -> Image.Image:  # noqa: ARG001 - hookspec の引数名
    dpi = image.info.get("dpi", (300, 300))
    out, scale = prepare_for_ocr(np.asarray(image.convert("L")))
    result = Image.fromarray(out)
    result.info["dpi"] = (dpi[0] * scale, dpi[1] * scale)
    return result
