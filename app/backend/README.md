# backend — FastAPI バックエンドAPI

ドキュメント管理・検索・認証・ログのREST API と OCRワーカーを提供する。

## 技術スタック
- FastAPI / SQLAlchemy 2.0 / PostgreSQL
- 認証: JWT (OAuth2 Password) — 将来 OIDC/SSO 連携 (F-34)
- 検索: OpenSearch (全文検索)
- ストレージ: S3互換 (MinIO) — 機密度でクラウド/オンプレ振り分け
- OCR: Tesseract (jpn+eng) + OpenCV 前処理

## ディレクトリ
```
app/
├── main.py             # エントリポイント / ルーター登録
├── core/               # 設定・セキュリティ
├── db/                 # DBセッション・Base
├── models/             # SQLAlchemy モデル (documents/users/access_logs)
├── schemas/            # Pydantic スキーマ
├── services/           # storage / search / ocr
├── api/routes/         # health/auth/documents/search/logs
└── workers/            # ocr_worker (非同期OCR)
```

## ローカル起動（compose 推奨: ../../platform 参照）
```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

- API docs: http://localhost:8000/docs

## マッピング（主要要件）
| 要件 | 実装 |
|---|---|
| F-13〜F-15 OCR | services/ocr.py, workers/ocr_worker.py |
| F-20 ハイブリッド保存 | services/storage.py |
| F-23〜F-26 検索 | services/search.py, api/routes/search.py |
| F-28〜F-30 ログ | models/access_log.py, api/routes/logs.py |
| F-33〜F-37 認証/権限 | core/security.py, api/deps.py, api/routes/auth.py |

> 雛形のため DBマイグレーション(alembic) と一部処理は未実装。詳細は ../../doc/task.md を参照。
