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

# 認識モデルを高精度版 tessdata_best に差し替える（apt 版は速度優先の tessdata_fast）。
# 撮影書類の合成ベンチで文字誤り率が大きく下がることを確認済み。osd(向き判定)は apt 版のまま使う。
ADD https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/jpn.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/jpn_vert.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/eng.traineddata \
    /tmp/tessdata_best/
RUN cd /tmp/tessdata_best \
    && printf '%s\n' \
       "36bdf9ac823f5911e624c30d0553e890b8abc7c31a65b3ef14da943658c40b79  jpn.traineddata" \
       "1258be6eb2a9851f18043234ad18cca13ed32690bfff62b335c898bbea371548  jpn_vert.traineddata" \
       "8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba  eng.traineddata" \
       | sha256sum -c - \
    && TESSDATA="$(dirname "$(find /usr/share/tesseract-ocr -name osd.traineddata | head -n1)")" \
    && chmod 644 ./*.traineddata && mv ./*.traineddata "$TESSDATA"/ \
    && rm -rf /tmp/tessdata_best \
    && tesseract --list-langs

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 非同期ワーカー (Celery等) を想定。雛形では polling ワーカーを起動
CMD ["python", "-m", "app.workers.ocr_worker"]
