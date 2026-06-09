"""OCR / 画像前処理 (F-03〜F-05, F-13〜F-15)。

OpenCV で輪郭検出・台形補正・二値化などの前処理を行い、
Tesseract(jpn+eng, 縦書き対応) でテキストを抽出する。
雛形のため処理は最小構成。
"""

import cv2
import numpy as np
import pytesseract

from app.core.config import settings


def preprocess(image_bytes: bytes) -> np.ndarray:
    """二値化・ノイズ除去などの前処理（OCR精度向上）。"""
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    # ノイズ除去
    img = cv2.fastNlMeansDenoising(img, h=10)
    # 適応的二値化
    img = cv2.adaptiveThreshold(
        img, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )
    return img


def extract_text(image_bytes: bytes) -> str:
    """画像から日本語/英数字テキストを抽出する。"""
    img = preprocess(image_bytes)
    return pytesseract.image_to_string(img, lang=settings.ocr_lang)


def deskew(img: np.ndarray) -> np.ndarray:
    """傾き補正 (F-04) のプレースホルダ。"""
    # TODO: ハフ変換等で傾き角を推定し回転補正する
    return img
