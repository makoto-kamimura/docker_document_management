# 計画: Expo SDK 57 対応と外部ストレージ連携（2026-10-18）

> 実装前の計画の記録。仕様の正は [README.md](../../README.md)（8.1節・17.3節・D13〜D15）。


## Context

- **モバイル**: `app/mobile` は Expo SDK 54（RN 0.81.5 / React 19.1）。SDK 57（RN 0.86 / React 19.2、2026-06-30 リリース）で起動できるよう更新する。54→57 の間で効く変更は次のとおり。
  - SDK 55: 旧アーキテクチャ廃止（本アプリは未指定＝新アーキなので影響なし）、パッケージのメジャー番号が SDK 番号と同じに
  - SDK 56: Hermes v1 が既定、iOS 16.4 以上、Node 20.19.4 以上、TypeScript 6.0、expo-file-system の `copy()`/`move()` が非同期に、`expo/fetch` が global fetch に（axios は XHR を使うので影響なし）
  - 本アプリ固有: `expo-file-system/legacy` に依存しているので新 API へ移行する。React Navigation v6 は v7 へ上げる。
- **ストレージ**: 画像・PDF は今 MinIO（S3 互換）の2バケットだけに保存している（`app/backend/app/services/storage.py`、機密度で cloud/onprem を振り分け）。テナント（家族）ごとに **Cloudflare R2 / 自分の Google ドライブ / Synology NAS（WebDAV）** を**メインの保存先**として選べるようにする。設定は Web 管理画面からテナント管理者が行い、認証情報は DB に暗号化して保存する。MinIO は既定の保存先として残し、既存の書類は元の場所のまま読めるようにする。
- 確認済みの方針: テナントごとに Web 管理画面で設定、メインの保存先を置き換える、Synology は WebDAV、Expo Go での起動は維持。

## 実装順序（コミット単位。ステージまでにとどめ、コミットはユーザーが行う）

1. README（仕様）更新 → 2. バックエンドの保存先の抽象化と MinIO 実装 → 3. R2・WebDAV → 4. Google ドライブ → 5. Web 管理画面 → 6. Expo SDK 57 → 7. runbook・env 例
作業ブランチは `feat/expo57-external-storage` を想定（main から切るか現ブランチから切るかは着手時に確認）。

---

## A. バックエンド: 保存先の抽象化

### A-1. `app/backend/app/services/storage.py` を複数の保存先に対応させる
今は全呼び出しが `put_object(location, key, ...)` / `get_object(location, key)` を通っている（documents.py と ocr_worker.py だけ）ので、ここを入口として差し替える。
- `services/storage_backends/` パッケージを新設し、共通インターフェース `ObjectStore` に `put(key, data, content_type)` / `get(key)` / `delete(key)` / `list(prefix)` / `test()` を定義する。
  - `s3.py`: `S3Store`。boto3 を使い、MinIO・R2・汎用 S3 で共用。R2 は `endpoint=https://<account_id>.r2.cloudflarestorage.com`、`region_name="auto"`、署名 s3v4。boto3 を 1.36 以上に上げる場合は R2 向けに `request_checksum_calculation="when_required"` を指定する。
  - `webdav.py`: `WebDAVStore`。httpx で PUT/GET/DELETE/PROPFIND を送り、途中のフォルダは MKCOL で作る（作成済みのパスはプロセス内でキャッシュ）。Basic 認証。Synology の自己署名証明書向けに `verify_tls` を切り替えられるようにする（既定は検証あり）。
  - `gdrive.py`: `GoogleDriveStore`（B 章）。
- 公開関数のシグネチャを `put_object(doc, key, data, content_type)` / `get_object(doc, key)` に変え、保存先を `doc` から決める。
  - `doc.storage_backend_id` が NULL なら従来どおり env の MinIO（`storage_location` でバケットを選ぶ）。**既存の書類はデータ移行なしで読める。**
  - 値があればその保存先を使う。キーは `{prefix}{doc_id}/...`（prefix の既定は `dms/`）。
- `resolve_target(tenant, sensitivity)` で新規書類の保存先を決める。
  - テナントに有効な保存先が設定されていればそれを使う。
  - ただし `confidential` の書類は、保存先が `is_onprem=True`（例: 自宅 NAS）のときだけ外部へ出し、それ以外は従来の MinIO onprem バケットに置く。README の原則「中身は、外に出さない」と F-20 を守るため。
- `ensure_buckets()` は env の MinIO のみを対象にしたまま残す。
- 呼び出し側の修正は機械的: `app/backend/app/api/routes/documents.py`（L109, 198–219, 264–267, 283, 306, 445–449, 528–542）、`app/backend/app/workers/ocr_worker.py`（L47, 55, 94, 163–176）。
- **既存バグの修正**: `PATCH /documents/{id}` は機密度を変えると `storage_location` だけ書き換えてオブジェクトを移していない（L398–400）。保存先が変わる場合は `storage.move_document(doc, new_target)` で `list(prefix)` → コピー → 削除を同期で行う。

### A-2. データモデル（`db/migrate.py` の冪等 DDL 方式に倣う。Alembic は使わない、README の決定 D12）
- 新モデル `app/backend/app/models/storage_backend.py` `StorageBackend`（`create_all` で作成される）:
  `id, tenant_id(FK, NOT NULL), kind(enum: s3|webdav|gdrive), preset(minio|r2|synology|generic など表示用), name, config(JSONB: endpoint/bucket/region/base_url/folder_id/prefix/verify_tls など秘密でない値), secret_encrypted(Text), is_onprem(bool), last_test_ok(bool), last_tested_at, created_at`
- `tenants.storage_backend_id UUID NULL`（現在の保存先。NULL なら既定の MinIO）
- `documents.storage_backend_id UUID NULL`（保存した時点の保存先。以後の読み書きはすべてこれを使う）
- 2カラムは `migrate.add_tenant_columns()` と同じ方式で `ADD COLUMN IF NOT EXISTS` を追加する。
- `models/__init__.py`、`schemas/storage.py`（秘密値は返さず、`has_secret: bool` だけ返す）を追加する。

### A-3. 秘密情報の暗号化
- `app/backend/app/core/crypto.py`: `cryptography.fernet` で `encrypt_json` / `decrypt_json` を提供する。鍵は env `STORAGE_SECRET_KEY`（Fernet 鍵）。未設定のときは外部保存先を保存できないようにし、エラーで案内する。
- `requirements.txt` に `cryptography` を明記する（今は python-jose の依存で入っているだけ）。

### A-4. API `app/backend/app/api/routes/storage.py`（`ADMIN_ROLES` かつ `require_tenant`。super_admin は既存の `X-Tenant-Id` で操作）
- `GET /storage/backends` 一覧 / `POST` 作成 / `PATCH /{id}` 更新（秘密値は空なら据え置き）/ `DELETE /{id}`（参照している書類があれば 409）
- `POST /storage/backends/{id}/test`: 疎通確認。プローブ用オブジェクトを put → get → delete し、結果を `last_test_ok` に記録する。
- `PUT /storage/active` `{backend_id | null}`: テナントの保存先を切り替える。テストに成功した保存先だけ選べる。
- **デモテナント（`is_demo`）では作成・切り替えを 403 にする**。デモ用アカウントは公開されているので、任意の URL を登録させると SSRF の踏み台になるため。
- `main.py` にルーターを登録する。

### A-5. 障害時の挙動
- アップロード時に外部保存先へ書けなければ 503 を返し、メッセージを日本語にする。モバイル側は既存のオフラインキュー（`src/offline.ts`）が再送する。
- ワーカーは既存の失敗処理に乗せる（取得・保存の例外はログに出し、ステータスを失敗にする）。
- 配信は今と同じくバックエンド経由のプロキシにする。R2 や Drive の URL をクライアントへ出さず、認証とテナント分離を保つため。

## B. Google ドライブ連携（OAuth）
- **スコープは `https://www.googleapis.com/auth/drive.file`**（アプリが作ったファイルにしか触れない。Google のセキュリティ審査が重いスコープを避けられる）。
- env に `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI`（`{API}/api/v1/storage/google/callback`）と、完了後に戻る `WEB_BASE_URL` を追加する。
- 流れ:
  1. `GET /storage/google/authorize` が認可 URL を返す。`state` は tenant_id・user_id・期限入りの署名付き JWT（既存の `core/security.py` の鍵を使う）で、`access_type=offline&prompt=consent` を付ける。
  2. `GET /storage/google/callback` でコードを交換し、refresh_token を暗号化して保存する。Drive に「紙ログ」フォルダを作り、その ID を `config.folder_id` に入れる。最後に Web の保存先設定画面へリダイレクトする。
- `GoogleDriveStore` は REST v3 を httpx で直接呼ぶ（google-api-python-client は依存が重いので入れない）。
  - access token は期限までプロセス内にキャッシュし、切れたら refresh token で更新する。
  - フォルダ構成は「紙ログ/{doc_id}/」で、ファイル名はキーの残り（例 `pages/000`）。各ファイルの `appProperties.dms_key` にフルキーを入れる。
  - get/上書きは `appProperties has {key='dms_key' and value='…'}` で検索する。キー→fileId はプロセス内 LRU にキャッシュする。
  - 同じキーへの put は `files.update` で上書きする。アップロードは `uploadType=multipart`。
- refresh token が失効したら（invalid_grant）`last_test_ok=false` にし、画面に「再連携」と出す。

## C. Web 管理画面（`app/web`）
- 新ページ `app/web/src/pages/StoragePage.tsx`（管理者のみ表示）。既存の `TenantsPage.tsx` / `UsersPage.tsx` の書き方に合わせる。
  - 保存先の一覧（種類、名前、テスト結果、使用中かどうか）と「この保存先を使う」ボタン
  - 追加フォームは種類ごとに分ける。
    - **Cloudflare R2**: Account ID、Access Key ID、Secret、Bucket
    - **Synology NAS（WebDAV）**: URL（例 `https://nas.local:5006`）、ユーザー、パスワード、フォルダ、TLS 検証、「自宅内（オンプレ）として扱う」チェック（機密書類の保存を許可する）
    - **Google ドライブ**: 「Google で連携」ボタン → authorize の URL へ遷移
    - **S3 互換（汎用）**: endpoint、region、keys、bucket
  - 「接続テスト」ボタン
- `app/web/src/api/client.ts` に API 関数を追加し、ルーターとナビゲーションにページを追加する。

## D. Expo SDK 57 対応（`app/mobile`、Expo Go で動かす前提）
1. `npx expo install expo@^57.0.0 --fix` を実行する。expo-* 全体（^57）、react 19.2.x、react-native 0.86.x、react-native-screens / safe-area-context、`@types/react`、`typescript`（~6.0）が揃う。続けて `npx expo-doctor@latest` を通す。`.npmrc` の `legacy-peer-deps` で隠れていた peer 依存の不整合も解消する。
2. **expo-file-system を新 API へ移行する**（`File` / `Directory` / `Paths`）。
   - `src/api/client.ts` L2, L60–64 の `downloadAuthed()`: `File.downloadFileAsync(url, new Directory(Paths.cache, ...), { headers, idempotent: true })` へ。
   - `src/offline.ts` L4, 8, 43, 50, 77: `Paths.document` 配下の `pending` ディレクトリを `Directory.create()`、`await file.copy()`（SDK 56 から非同期）、`file.delete()` で扱う。
   - キューに残っている既存の URI（`file://…/pending/…`）はそのまま `new File(uri)` で読めるので、移行処理はいらない。
3. **React Navigation を 7 へ上げる**（`@react-navigation/native` / `native-stack` ^7）。`App.tsx` と各画面の `navigate` を確認し、v7 で「既存の画面へ戻る」動作が無くなった箇所は `popTo` に直す。型 `NativeStackScreenProps` の import 先はそのまま。
4. `app.json`: 追加の必須項目はない。Android は edge-to-edge が必須になったので、各画面の上下の余白（SafeArea）を実機で確認する。
5. 動作要件: Node 20.19.4 以上（22 LTS 推奨）、端末に **SDK 57 対応の Expo Go**、iOS 16.4 以上。

## E. ドキュメント（README＝仕様を先に更新）
- `README.md`
  - 技術スタック §15（Expo SDK 57 / RN 0.86 / React 19.2）
  - F-20 の拡張か新しい F 番号で「外部ストレージ連携（R2 / Google ドライブ / Synology WebDAV）」を追加
  - §17.3 保存の仕組み、§18 データモデル（storage_backends と2カラム）、§19 API、§20 秘密情報の暗号化
  - §21 決定事項に D13「保存先はテナント単位でメインを置き換え、既存書類は元の場所」と D14「機密書類はオンプレの保存先にだけ置く」を追加
- `docs/runbooks/operation.md`: SDK 57 の起動手順、R2 の API トークン作成、Google Cloud の OAuth クライアント作成（リダイレクト URI）、Synology の WebDAV Server の有効化（ポート 5006）を追記する。
- `docs/runbooks/qr.md`、`app/mobile/README.md` の SDK 表記を更新する。
- `docs/design/plan-external-storage.md` に本計画を残す（設計の記録として）。
- `platform/.env.example` / `app/backend/.env.example` に `STORAGE_SECRET_KEY`、`GOOGLE_OAUTH_*`、`WEB_BASE_URL` を追加する。`platform/docker-compose.yml` では ocr-worker にも S3 の認証情報（既存の漏れ）と上記の env を渡す。

## F. テスト（今は無いので最低限を追加）
- `app/backend/tests/` を新設し、requirements-dev に pytest を追加する。
  - `test_crypto.py`: 暗号化して復号すると元に戻る。
  - `test_webdav_store.py` / `test_gdrive_store.py`: `httpx.MockTransport` で put/get/delete/list と、トークン更新、appProperties 検索を確認する。
  - `test_resolve_target.py`: 機密書類がオンプレでない保存先へ出ないこと、NULL の書類が従来の MinIO を使うこと。

## 検証（エンドツーエンド）
1. `cd platform && docker compose up --build` で backend と ocr-worker が起動し、既存の書類のサムネイル・ページ・PDF が今までどおり表示される（後方互換）。
2. **WebDAV**: NAS が無くてもローカルの WebDAV コンテナ（例 `rclone serve webdav`）で確認できる。保存先を登録 → 接続テスト → 使用中にする → モバイルから撮影してアップロード → WebDAV 側に `dms/{doc_id}/pages/000`・`proc/`・`preview.jpg`・`document.pdf` ができ、アプリで表示できる。そのあと実機の Synology でも同じ確認をする。
3. **R2**: 実バケットで同じ流れを確認する。
4. **Google ドライブ**: OAuth で連携 → Drive に「紙ログ/{doc_id}/…」ができる → 表示と PDF 共有ができる → 連携を解除すると「再連携」と表示される。
5. 機密書類が、オンプレでない保存先が選ばれていても MinIO onprem に入る。機密度を変えるとオブジェクトが移動する。
6. デモテナントの管理者が保存先 API を呼ぶと 403 になる。
7. モバイル: `npx expo-doctor@latest` と `npx tsc --noEmit` が通る。`EXPO_PUBLIC_API_BASE_URL=http://<IP>:8000 npx expo start --port 8082` で起動し、Expo Go（SDK 57）で次を確認する。
   - ログイン、一覧、詳細、撮影・ライブラリ・PDF のアップロード
   - サムネイル、PDF 共有
   - 機内モードでアップロード → キューに入る → 「今すぐ同期」で再送される
   - 通知画面
8. `pytest app/backend/tests` が通る。
