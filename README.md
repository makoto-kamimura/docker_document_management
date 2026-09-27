# 紙ログ（紙媒体資料 撮影・電子保存・閲覧管理システム）

> **紙ログ** は本システムの呼称です（旧称: 紙媒体電子管理システム）。
> リポジトリ名・パッケージ名（`dms-web` / `dms-mobile`）・Docker サービス名などの識別子は変更していません。

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

## 家族で紙を見逃さない（撮影 → OCR → 解析 → 通知 → 確認）

家に届いた紙を撮影すると、OCR したテキストから**重要度と期限**を判定し、家族に知らせる。
誰が確認して誰がまだかを共有し、**全員が確認したらリマインドを止める**。

```text
📷 撮影 → OCR → 文書解析（重要度/期限/対象/キーワード）→ 家族へ通知
        → 未読/既読・対応状況（確認した/対応する/対応済み/あとで確認）→ 全員確認で通知終了
```

- 家族の単位は既存の**グループ**（同じグループのメンバーは書類を自動で閲覧できる）。
- 通知はアプリ内通知（未読バッジ・一覧・再通知・リマインド）。実機へのプッシュは
  Expo の projectId を設定すると有効になる（[app/mobile/README.md](app/mobile/README.md)）。
- 解析は外部サービスに本文を送らないルールベース。プッシュ本文にも書類の中身は載せない。
- 詳細: [doc/plan-family-notify.md](doc/plan-family-notify.md)

## デモと実利用を分ける（テナント分離）

利用する世帯/組織ごとに **テナント** を分け、ユーザー・グループ・書類・通知をその中に閉じ込める。

- 公開しているお試しアカウントは**デモテナント**の 管理者 / 登録者 / 閲覧者 の3つ
  （`demo@example.com` / `demo-registrar@example.com` / `demo-viewer@example.com`）。
  ロールごとの見え方を試せる。実利用の書類は見えない。
  アカウントの案内はポートフォリオ側に載せ、アプリのログイン画面には出さない。
- ロールは **全体管理者（非公開・全テナント）/ 管理者（テナント内）/ 登録者 / 閲覧者** の4段階。
  全体管理者は既定では作成せず、運用者の既存ユーザーを昇格させる（[doc/operation.md](doc/operation.md)）。
- 一覧・検索・通知はすべてテナントで絞り込まれ、別テナントのリソースは存在を伏せて 404 を返す。
- 既存DBは起動時に自動移行される（既存データは実利用テナントへ）。複数ワーカーで起動しても
  初期化はロックで1プロセスずつ実行される。

> 設計と運用: [doc/plan-tenants.md](doc/plan-tenants.md) / [doc/operation.md](doc/operation.md)

## 技術スタック

| 領域 | 技術 |
|---|---|
| モバイル | React Native (Expo) / TypeScript / expo-camera |
| Webフロント | React / TypeScript / Vite |
| バックエンド | FastAPI / SQLAlchemy / PostgreSQL |
| OCR | Tesseract (jpn+jpn_vert+eng, 高精度モデル tessdata_best) + OpenCV |
| 文書解析・通知 | ルールベース解析（重要度・期限）+ アプリ内通知 / Expo プッシュ |
| 要約・PDF出力 | Dify（`DIFY_API_KEY` 未設定時はルールベース簡易要約）/ reportlab |
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
OCR/保存・閲覧/検索）、フェーズ9（家族での共有・通知）、フェーズ10（テナント分離）の主要機能は実装済み。
未着手は閲覧・操作ログの自動記録（F-28/F-29）、集計レポート（F-40）、保管期限（F-41）、
MFA/SSO（F-34）、非機能・運用系など。
