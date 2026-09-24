"""撮影画像のスキャン処理 (F-03〜F-09)。

OpenCV で 書類輪郭検出→透視変換(台形補正/トリミング)→補正(明るさ/コントラスト)→
カラーモード変換 を行い、品質指標(ブレ/明るさ/解像度/影ムラ)を算出する。
端末(Expo)では困難なため、アップロード後にサーバー側で実施する（ベストエフォート）。
"""

from __future__ import annotations

import cv2
import numpy as np

# 撮影モード
MODE_COLOR = "color"
MODE_GRAY = "gray"
MODE_BW = "bw"
VALID_MODES = {MODE_COLOR, MODE_GRAY, MODE_BW}


def _order_points(pts: np.ndarray) -> np.ndarray:
    """4点を [左上, 右上, 右下, 左下] に並べ替える。"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _find_document_quad(img: np.ndarray) -> np.ndarray | None:
    """最大の四角形輪郭（書類の外形）を検出する。見つからなければ None。"""
    h, w = img.shape[:2]
    ratio = 1000.0 / max(h, w) if max(h, w) > 1000 else 1.0
    small = cv2.resize(img, (int(w * ratio), int(h * ratio)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    img_area = small.shape[0] * small.shape[1]
    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.contourArea(approx) > 0.25 * img_area:
            return approx.reshape(4, 2).astype("float32") / ratio
    return None


def _warp(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """四角形を上から見た矩形に透視変換する（台形補正＋トリミング）。"""
    rect = _order_points(quad)
    (tl, tr, br, bl) = rect
    widthA = np.linalg.norm(br - bl)
    widthB = np.linalg.norm(tr - tl)
    heightA = np.linalg.norm(tr - br)
    heightB = np.linalg.norm(tl - bl)
    maxW = max(int(widthA), int(widthB))
    maxH = max(int(heightA), int(heightB))
    if maxW < 10 or maxH < 10:
        return img
    dst = np.array(
        [[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]], dtype="float32"
    )
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, M, (maxW, maxH))


def _enhance_color(img: np.ndarray) -> np.ndarray:
    """デノイズ + CLAHE(明るさ/コントラスト最適化)。"""
    img = cv2.fastNlMeansDenoisingColored(img, None, 5, 5, 7, 21)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


# OCR 用画像の長辺の目安（A4 を 300dpi 相当で読める文字サイズ）。これより小さい画像は拡大する。
OCR_TARGET_LONG_SIDE = 3500
OCR_MAX_UPSCALE = 2.5


def normalize_illumination(gray: np.ndarray) -> np.ndarray:
    """紙の明るさ(背景)を推定して割り、影・照明ムラを取り除く (F-05)。

    文字より大きい窓の最大値フィルタで文字を消した「紙だけの画像」を作り、元画像を
    それで割る。縮小画像で推定して計算量を抑える。
    """
    h, w = gray.shape[:2]
    s = 4
    small = cv2.resize(gray, (max(w // s, 1), max(h // s, 1)), interpolation=cv2.INTER_AREA)
    k = max(9, (min(small.shape[:2]) // 30) | 1)
    bg = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    bg = cv2.medianBlur(bg, min(k, 255))
    bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.divide(gray, bg, scale=255)


def prepare_for_ocr(gray: np.ndarray) -> tuple[np.ndarray, float]:
    """OCR エンジンに渡す専用画像を作る（PDF に載る表示用画像とは別, F-13/F-15）。

    影・照明ムラの除去と、文字が小さい低解像度画像の拡大を行う。二値化は Tesseract に
    任せる（事前に二値化すると細い明朝体がかすれて精度が落ちる）。戻り値は (画像, 拡大率)。
    """
    out = normalize_illumination(gray)
    h, w = out.shape[:2]
    scale = min(OCR_TARGET_LONG_SIDE / max(h, w), OCR_MAX_UPSCALE)
    if scale <= 1.05:
        return out, 1.0
    out = cv2.resize(out, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    return out, scale


def _compute_quality(gray: np.ndarray) -> dict:
    """品質指標と警告(ブレ/暗さ/明るすぎ/影ムラ/低解像度)を算出 (F-09/F-07)。"""
    h, w = gray.shape[:2]
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    # 大きくぼかした照明成分の分散で影ムラを推定。低周波成分だけを見るので、
    # 1/8 に縮小して同じ相対半径でぼかす（原寸だと巨大カーネルで1枚10秒近くかかる）
    s = 8
    small = cv2.resize(gray, (max(w // s, 1), max(h // s, 1)), interpolation=cv2.INTER_AREA)
    illum = cv2.GaussianBlur(small, (0, 0), sigmaX=max(h, w) / 30.0 / s)
    shadow = float(illum.std())

    warnings: list[str] = []
    if min(h, w) < 1000:
        warnings.append("low_resolution")
    if blur < 100:
        warnings.append("blurry")
    if brightness < 60:
        warnings.append("too_dark")
    if brightness > 225:
        warnings.append("too_bright")
    if shadow > 45:
        warnings.append("uneven_lighting")
    return {
        "width": w,
        "height": h,
        "blur_score": round(blur, 1),
        "brightness": round(brightness, 1),
        "shadow_score": round(shadow, 1),
        "warnings": warnings,
    }


def scan_page(image_bytes: bytes, mode: str = MODE_COLOR) -> tuple[bytes, dict]:
    """1ページ分の画像をスキャン処理し、(処理後JPEG/PNGバイト, 品質dict) を返す。

    処理に失敗した場合は元画像を返しフォールバックする（堅牢性優先）。
    """
    mode = mode if mode in VALID_MODES else MODE_COLOR
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes, {"warnings": ["decode_failed"]}

    # 元画像の品質（再撮影判定は補正前の状態で評価する）
    quality = _compute_quality(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))

    # 台形補正 + トリミング
    try:
        quad = _find_document_quad(img)
        if quad is not None:
            warped = _warp(img, quad)
            if warped.size > 0:
                img = warped
                quality["cropped"] = True
    except Exception:
        pass

    # モード別の仕上げ
    try:
        if mode == MODE_BW:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            gray = cv2.fastNlMeansDenoising(gray, None, 10)
            out = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
            )
            ok, buf = cv2.imencode(".png", out)
        elif mode == MODE_GRAY:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
            ok, buf = cv2.imencode(".jpg", gray, [cv2.IMWRITE_JPEG_QUALITY, 90])
        else:
            out = _enhance_color(img)
            ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if ok:
            quality["mode"] = mode
            return buf.tobytes(), quality
    except Exception:
        pass

    return image_bytes, quality
