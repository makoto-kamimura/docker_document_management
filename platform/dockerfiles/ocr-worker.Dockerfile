# OCR / 画像前処理ワーカー
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Tesseract(日本語縦書き含む) + OpenCV + PDF処理の依存
# ghostscript は ocrmypdf による検索可能PDF生成に必須 (F-14)。
# osd=向き/回転検出(rotate_pages), unpaper=汚れ/ノイズ除去(clean) で OCR 精度を底上げ。
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    tesseract-ocr tesseract-ocr-jpn tesseract-ocr-jpn-vert tesseract-ocr-osd \
    poppler-utils ghostscript unpaper \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 非同期ワーカー (Celery等) を想定。雛形では polling ワーカーを起動
CMD ["python", "-m", "app.workers.ocr_worker"]
