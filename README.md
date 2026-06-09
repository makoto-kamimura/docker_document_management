# 紙媒体資料 撮影・電子保存・閲覧管理システム

スマートフォン/タブレットで紙資料を撮影し、OCRで検索可能なドキュメントとして
電子保存・閲覧管理するハイブリッド構成（オンプレ + クラウド）のシステム。

- 要件定義: [doc/document_management_system_requirements.md](doc/document_management_system_requirements.md)
- 設計書: [doc/design.md](doc/design.md)
- タスク一覧: [doc/task.md](doc/task.md)
- 起動・運用手順: [doc/operation.md](doc/operation.md)

## ディレクトリ構成

```
docker_document_management/
├── app/
│   ├── backend/    # FastAPI バックエンドAPI + OCRワーカー (Python)
│   ├── web/        # 管理・検索 Webアプリ (React + Vite + TS)
│   └── mobile/     # 撮影・閲覧モバイルアプリ (React Native + Expo + TS)
├── platform/       # Docker 実行基盤 (compose / Dockerfile)
└── doc/            # 設計ドキュメント (design.md / task.md)
```

## 技術スタック

| 領域 | 技術 |
|---|---|
| モバイル | React Native (Expo) / TypeScript / expo-camera |
| Webフロント | React / TypeScript / Vite |
| バックエンド | FastAPI / SQLAlchemy / PostgreSQL |
| OCR | Tesseract (jpn+eng, 縦書き) + OpenCV |
| 全文検索 | OpenSearch |
| ストレージ | S3互換 (MinIO) — 機密度でオンプレ/クラウド振り分け |
| 認証 | JWT (OAuth2) ／ 将来 OIDC・SSO |
| 実行基盤 | Docker / Docker Compose |

## クイックスタート（バックエンド + インフラ + Web）

```bash
cd platform
cp .env.example .env
docker compose up --build
```

- API: http://localhost:8000/docs
- Web: http://localhost:5173
- MinIO コンソール: http://localhost:9001

モバイルは別途 `app/mobile` で `npm install && npm start`（[app/mobile/README.md](app/mobile/README.md) 参照）。

## 設定・シークレット

- 各環境の設定は `*.env.example` をコピーして `.env` を作成する（`.env` は `.gitignore` 済みでコミットされない）。
  - `platform/.env`（compose 用）, `app/web/.env`（Web 用）, `app/backend/.env`（API 単体起動時）。
- 本番では `JWT_SECRET` や各データストアのパスワード、`DIFY_API_KEY` を必ず変更すること
  （`.env.example` の値は開発用ダミー）。

## 実装状況

各要件 (F-01〜F-41) の実装状況は [doc/task.md](doc/task.md) を参照。フェーズ1〜4（認証/権限・撮影取込・
OCR/保存・閲覧/検索）は実装済み。
