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

COPY requirements.txt requirements-ocr.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-ocr.txt

# 撮影した書類の本文を読む PaddleOCR（PP-OCR の ONNX 版, app/services/paddle_ocr.py）のモデル。
# 実行時にダウンロードしないよう、ビルド時に取り込んで sha256 を確かめる。
# どのモデルを使うかは scripts/ocr_eval.py で比べて決めた（OCR_PADDLE_PRESET と合わせる）。
ARG PADDLE_OCR_PRESET=v6-small
ENV PADDLE_OCR_MODEL_DIR=/opt/paddle-ocr
RUN set -eu; mkdir -p "$PADDLE_OCR_MODEL_DIR"; cd "$PADDLE_OCR_MODEL_DIR"; \
    base=https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx; \
    case "$PADDLE_OCR_PRESET" in \
      v6-small) \
        det="$base/PP-OCRv6/det/PP-OCRv6_det_small.onnx 090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"; \
        rec="$base/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx 6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884" ;; \
      v6-medium) \
        det="$base/PP-OCRv6/det/PP-OCRv6_det_medium.onnx 92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2"; \
        rec="$base/PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b" ;; \
      v5-server) \
        det="$base/PP-OCRv5/det/ch_PP-OCRv5_det_server.onnx 0f8846b1d4bba223a2a2f9d9b44022fbc22cc019051a602b41a7fda9667e4cad"; \
        rec="$base/PP-OCRv5/rec/ch_PP-OCRv5_rec_server.onnx e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a" ;; \
      *) echo "unknown PADDLE_OCR_PRESET: $PADDLE_OCR_PRESET" >&2; exit 1 ;; \
    esac; \
    for pair in "det:$det" "rec:$rec"; do \
      kind="${pair%%:*}"; rest="${pair#*:}"; url="${rest% *}"; sum="${rest##* }"; \
      out="$PADDLE_OCR_PRESET-$kind.onnx"; \
      python -c "import sys,urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$url" "$out"; \
      echo "$sum  $out" | sha256sum -c -; \
    done; \
    chmod 644 ./*.onnx; ls -la

COPY . .

# 非同期ワーカー (Celery等) を想定。雛形では polling ワーカーを起動
CMD ["python", "-m", "app.workers.ocr_worker"]
