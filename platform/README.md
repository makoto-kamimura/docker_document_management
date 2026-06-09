# platform — Docker 実行基盤

ハイブリッド構成のローカル/開発環境を Docker Compose で起動する。

## 構成サービス

| サービス | 役割 | ポート |
|---|---|---|
| postgres | メタDB（ドキュメント/ユーザ/権限/ログ） | 5432 |
| opensearch | 全文検索エンジン（OCRテキスト索引） | 9200 |
| minio | S3互換オブジェクトストレージ（非機密ドキュメント） | 9000 / 9001(console) |
| backend | FastAPI バックエンドAPI | 8000 |
| ocr-worker | OCR/画像前処理ワーカー（Tesseract + OpenCV） | - |
| web | React + Vite Webアプリ | 5173 |

> mobile (React Native) は端末/エミュレータで実行するため Compose には含めない。

## 起動手順

```bash
cd platform
cp .env.example .env       # 必要に応じ値を編集
docker compose up --build
```

- API ドキュメント: http://localhost:8000/docs
- Web: http://localhost:5173
- MinIO コンソール: http://localhost:9001

## ディレクトリ

```
platform/
├── docker-compose.yml      # 全サービス定義
├── .env.example            # 環境変数テンプレート
└── dockerfiles/
    ├── backend.Dockerfile
    ├── ocr-worker.Dockerfile
    └── web.Dockerfile
```

## 本番 / オンプレ補足

- 機密ドキュメントはオンプレミスのストレージ（別MinIO/NAS等）へ振り分ける想定。
- 本番では `DISABLE_SECURITY_PLUGIN` を無効化し、TLS・認証を有効にすること。
