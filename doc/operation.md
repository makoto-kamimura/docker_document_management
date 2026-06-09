# 起動・運用手順 (operation.md)

ローカル開発環境での起動手順をまとめる。構成は **バックエンド+インフラ (Docker)** / **Webアプリ (Docker)** / **モバイルアプリ (Expo, ホスト上で起動)** の3系統。

- システム概要・要件は [README.md](../README.md) / [document_management_system_requirements.md](document_management_system_requirements.md) を参照。

## 0. 前提ソフトウェア

| 用途 | ソフトウェア | 確認コマンド |
|---|---|---|
| バックエンド/インフラ/Web | Docker Desktop | `docker --version` / `docker compose version` |
| モバイル開発 | Node.js (18+) | `node --version` |
| モバイル実機確認 | スマホに **Expo Go** アプリ（**Expo SDK 54** 対応版） | App Store / Google Play |

> Docker Desktop は事前に起動しておく（デーモンが立ち上がるまで数十秒かかる）。
> 起動確認: `docker info` がエラーなく返ること。

## 初期ログインアカウント（開発用）

バックエンド初回起動時に自動投入される。

- **メールアドレス**: `admin@example.com`
- **パスワード**: `admin123`

> 投入値は `platform/.env` 経由で上書き可能（`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` を設定し、バックエンド設定の `seed_admin_email` / `seed_admin_password` に対応）。本番運用では必ず変更すること。

---

## 1. バックエンド + インフラ + Web (Docker)

PostgreSQL / OpenSearch / MinIO / バックエンドAPI / OCRワーカー / Web をまとめて起動する。

```bash
cd platform
cp .env.example .env        # 初回のみ
docker compose up --build   # 初回はイメージ取得/ビルドで数分かかる
```

起動後のアクセス先:

| サービス | URL | 備考 |
|---|---|---|
| **Web画面** | http://localhost:5173 | ログイン画面が表示される |
| API (Swagger UI) | http://localhost:8000/docs | エンドポイント確認・手動操作 |
| MinIO コンソール | http://localhost:9001 | ログイン: `minioadmin` / `minioadmin` |
| PostgreSQL | localhost:5432 | user/pass/db = `dms` / `dms_password` / `dms` |
| OpenSearch | http://localhost:9200 | |

### 起動確認

```bash
# 全コンテナの状態
docker compose ps

# バックエンドのヘルスチェック
curl http://localhost:8000/api/v1/health

# ログイン → トークン取得 → 一覧取得 (200 + [] が返ればOK)
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@example.com&password=admin123" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/documents
```

### 補足

- バックエンドは起動時に **DBテーブルの自動作成**と**初期管理者ユーザーの投入**を行う（`app/backend/app/main.py` の `lifespan`）。
- バックエンドは `--reload` 付きで起動するため、`app/backend` 配下のコード変更は自動反映される。
  `requirements.txt` を変更した場合のみ再ビルドが必要:
  ```bash
  docker compose up -d --build backend
  ```

### 停止

```bash
cd platform
docker compose down          # コンテナ停止・削除（データは残る）
docker compose down -v       # ボリュームも削除（DB/検索/ストレージを初期化）
```

---

## 2. Webアプリ単体で起動する場合 (任意)

通常は上記 Docker でWebも起動するため不要。フロントだけを手早く動かしたいときの手順。

```bash
cd app/web
cp .env.example .env          # VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev                   # http://localhost:5173
```

> バックエンドAPI (`localhost:8000`) は別途 Docker で起動しておくこと。

---

## 3. モバイルアプリ (Expo / 実機)

カメラ撮影が主機能のため、**実機 + Expo Go** での確認を推奨（iOSシミュレータ等ではカメラが使えない）。

> 本アプリは **Expo SDK 54**（React Native 0.81 / React 19.1）。スマホの Expo Go が対応するSDKと一致している必要がある（不一致だと `Project is incompatible with this version of Expo Go`）。端末の Expo Go が古い場合は更新、更新できない場合はプロジェクトを端末側のSDKに合わせる。

### 前提

- スマホと開発機 (Mac) を **同じ Wi-Fi (LAN)** に接続する。
- 開発機のLAN IP を確認する:
  ```bash
  ipconfig getifaddr en0      # 例: 192.168.100.165
  ```

### 起動

```bash
cd app/mobile
npm install                                  # 初回のみ
EXPO_PUBLIC_API_BASE_URL=http://<開発機のIP>:8000 npx expo start --port 8082
```

- `EXPO_PUBLIC_API_BASE_URL` には**バックエンドのアドレス**を開発機のLAN IPで指定する（`localhost` だと実機から到達できない）。
- `--port 8082` は、別のExpoプロジェクトが 8081 を使用している場合の回避。空いていれば省略可。

### 実機で開く

1. スマホで **Expo Go** を起動。
2. **「Enter URL manually」** に次を入力して接続:
   ```
   exp://<開発機のIP>:8082
   ```
   （iOSは標準カメラでExpoが表示するQRを読むと自動でExpo Goが開く）
3. 初回はJSバンドルの配信に少し時間がかかる。

### 動作フロー

1. **ログイン画面** … `admin@example.com` / `admin123` でサインイン (F-33)。
2. **撮影画面** (F-01/F-02/F-06/F-08/F-10/F-11):
   - 上部で **カラー/グレー/白黒** モードを選択 (F-06)。
   - **「撮影」**で複数ページを連続撮影。下部のサムネイル列で **削除(×)・並べ替え(◀▶)** (F-02/F-08)。
   - **「ライブラリ」**で端末の画像、**「PDF」**で既存PDFを取込 (F-10)。
   - **「保存（Nページ）」**で1ドキュメントとしてアップロード。低解像度時は警告 (F-09)。
   - 圏外時は端末に退避され、**「未送信N件を同期」**で再送（復帰時に自動再送）(F-11)。
3. 右上 **「一覧 ›」** … ドキュメント一覧。**未読/既読タブ**と**リスト/サムネイル切替**、下スワイプで更新 (F-21/F-32)。
4. **一覧の行をタップ** … 詳細画面で**撮影画像をプレビュー** (F-22)。
   **複数ページは「‹ 前へ / 次へ ›」でページ送り**して全ページの画像を確認できる。
5. 詳細画面の **「電子資料PDF（検索可能）を保存」** … OCR完了時にワーカーが自動生成・保存した
   検索可能PDF（画像＋透明OCRテキスト層, F-14）を**共有シート**で保存/送信。
6. 詳細画面の **「OCRテキストPDFを保存」** … **OCRで認識した文字を集約した全文PDF**を生成し、共有シートで保存/送信。
7. 詳細画面の **「要約PDFを出力」** … OCRテキストを要約した電子資料PDFを生成し、**共有シート**で保存/送信。
   OCR完了前は出力不可（「OCRがまだ完了していません」）。

> **検索可能PDF（電子資料）** は撮影後の非同期OCR処理の中で自動生成され、MinIO に
> `{documentId}/document.pdf` として保存される。生成には `ocrmypdf` + `ghostscript` を使う
> （ワーカーイメージに同梱済み）。未生成（OCR未完了/生成失敗）なら取得時 404。

> **サーバー側画像処理 (F-03〜F-09)**: 撮影画像はアップロード後、ワーカーの **OpenCV** で
> 輪郭検出→台形補正/トリミング→CLAHE補正→モード変換(カラー/グレー/白黒) を自動適用し、
> 処理済みプレビュー `{id}/preview.jpg`・統合PDF・品質結果 `{id}/quality.json` を保存する。
> 品質警告（ブレ/暗さ/明るすぎ/影ムラ/低解像度）は `GET /api/v1/documents/{id}/quality` で取得可。
> ※ Expo Go の制約で端末側CVが困難なためサーバー側で実施。**ベストエフォート**であり、商用
> ドキュメントスキャナ水準のロバストさ（指写り除去等）は保証しない。

> **Webの一覧 (http://localhost:5173)** にも **未読/既読タブ** と **リスト/サムネイル切替** を追加。
> サムネイルは `/documents/{id}/content`（処理済みプレビュー）を表示する。

> 要約は **Dify** で生成する（後述）。`DIFY_API_KEY` 未設定時はルールベースの簡易要約にフォールバックするため、Dify を立てる前でもPDF出力自体は動作する。

### 要約エンジン (Dify) の設定

要約PDFの本文生成に Dify を利用する。`platform/.env` に設定する:

```
DIFY_API_BASE=https://api.dify.ai/v1   # 自己ホストなら http://<host>/v1
DIFY_API_KEY=app-xxxxxxxx              # Dify アプリのAPIキー（空ならルールベース要約）
DIFY_APP_TYPE=completion               # completion | workflow
DIFY_INPUT_VAR=text                    # Difyアプリ側の入力変数名に合わせる
DIFY_OUTPUT_VAR=summary                # workflow時の出力ノード変数名
```

- Dify 側で「要約」アプリ（completion もしくは workflow）を作成し、入力変数名を `DIFY_INPUT_VAR` と一致させる。
- 設定変更後はバックエンド再起動: `docker compose up -d backend`。

### 関連APIエンドポイント（補足）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/v1/documents` | 複数ページ(`files`)＋`mode`(color/gray/bw)で登録（複数ページ=1ドキュメント） |
| GET | `/api/v1/documents/{id}/content` | 処理済みプレビュー画像を返す（未処理は生ページにフォールバック） |
| GET | `/api/v1/documents/{id}/quality` | 画質チェック結果（ブレ/暗さ/影/解像度の警告） |
| GET | `/api/v1/documents/{id}/document-pdf` | ワーカーが生成・保存した検索可能PDF（電子資料）を返す（未生成は 404） |
| GET | `/api/v1/documents/{id}/pdf` | OCRテキストを要約した電子資料PDFを生成して返す（OCR未完了は 409） |
| GET | `/api/v1/documents/{id}/ocr-pdf` | **OCRで認識した文字を集約した全文PDF**を生成して返す（要約ではなく全文。OCR未完了は 409） |
| PATCH | `/api/v1/documents/{id}` | メタデータ（タイトル/カテゴリ/書類種別/機密度/タグ）・OCRテキストの編集→再索引（編集権限） |
| GET | `/api/v1/documents/{id}/pages/{i}/content` | ページ単位の処理済み画像（ページめくりビューア用） |
| GET/POST | `/api/v1/documents/{id}/versions` | バージョン履歴の取得 / 差し替え（新版アップロード→履歴退避→再OCR、編集権限） |
| POST | `/api/v1/documents/{id}/print-log` | 印刷操作のログ記録（閲覧権限） |

### LANで繋がらない場合（トンネルモード）

社内/学内ネットワーク等でクライアント間通信が遮断される場合は、トンネル経由にする:

```bash
EXPO_PUBLIC_API_BASE_URL=http://<開発機のIP>:8000 npx expo start --port 8082 --tunnel
```

> 初回は `@expo/ngrok` の導入を促される。なおAPI (`8000`) 側はトンネルされないため、トンネル運用時はAPIを別途公開する必要がある点に注意。

---

## 4. ユーザー・権限管理（Web 管理画面） (F-35/F-36/F-37/F-38)

**管理者ロール**のユーザーで Web (http://localhost:5173) にログインすると、左メニューに
**「ユーザー管理」** が表示される（管理者以外には表示されない）。

### ユーザーのマスタ管理
- **追加**: 「＋ ユーザーを追加」→ メール/氏名/部署/ロール/初期パスワード（管理者が設定）。
- **ロール変更**: 一覧の行内セレクトで 管理者/登録者/閲覧者 を切替。
- **PWリセット / 削除**: 各行のボタンから。
- ガード: 自分自身のロール変更・削除、最後の管理者の降格・削除は不可（サーバー側でも拒否）。

### ドキュメント単位のアクセス権限（ACL）
- 「ドキュメント一覧」各行の **「権限設定」**（管理者またはそのドキュメントの所有者のみ表示）。
- ユーザーごとに **権限なし / 閲覧のみ / 編集可 / 削除可** を設定。所有者と管理者は常にフル権限。
- 付与されていないユーザーには、一覧・閲覧・PDF取得が**非表示/403**になる。

### グループと自動共有 (F-36)
- 左メニュー **「グループ管理」**（管理者のみ）でグループを作成し、**メンバー管理**で所属ユーザーを追加/削除。
- **同じグループに所属するメンバーは、メンバーがアップロードしたドキュメントを自動で閲覧できる**
  （個別のACL付与は不要）。判定は「現在の共通グループ」で動的に行われ、グループから外すと即座に見えなくなる。
- 自動共有は **閲覧(view)** のみ。編集/削除は従来どおり所有者/管理者/明示ACL。

### 既読管理 (F-32)
- ドキュメントを開く（Web/モバイルで閲覧・プレビュー）と、**閲覧者と日時が記録**され「既読」になる。
- ドキュメント一覧に **未読/既読バッジ**が表示される（各ユーザー自身の状態）。自分がアップロードした物は既読扱い。
- ドキュメント一覧の **「既読者」**（管理者/所有者）で **誰がいつ読んだか** を確認できる。モバイルは詳細画面下部に既読者一覧。

### 関連APIエンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/v1/auth/me` | ログイン中ユーザー情報（ロール判定/ヘッダ表示） |
| GET/POST | `/api/v1/users` | ユーザー一覧 / 作成（**管理者限定**） |
| PATCH/DELETE | `/api/v1/users/{id}` | 更新（氏名/部署/ロール）/ 削除（**管理者限定**） |
| POST | `/api/v1/users/{id}/password` | パスワードリセット（**管理者限定**） |
| GET/POST | `/api/v1/groups` | グループ一覧 / 作成（**管理者限定**） |
| PATCH/DELETE | `/api/v1/groups/{id}` | グループ更新 / 削除（**管理者限定**） |
| GET | `/api/v1/groups/{id}/members` | グループ所属メンバー一覧（**管理者限定**） |
| PUT/DELETE | `/api/v1/groups/{id}/members/{userId}` | メンバー追加 / 削除（**管理者限定**） |
| GET | `/api/v1/documents/{id}/permissions` | ドキュメントのACL一覧（管理者/所有者） |
| PUT/DELETE | `/api/v1/documents/{id}/permissions/{userId}` | ACL の付与・変更 / 解除（管理者/所有者） |
| GET | `/api/v1/documents/{id}/reads` | 既読者一覧（誰がいつ, 管理者/所有者） |

> ロール: `admin`(管理者) / `registrar`(登録者) / `viewer`(閲覧者)。権限レベル: `view` < `edit` < `delete`（上位は下位を包含）。
> ドキュメント一覧 `GET /api/v1/documents` は各件に現在ユーザー基準の `is_read` と `tags` を含む。

---

## 5. 全文検索・要約・メタデータ・バージョン (F-23〜F-26, F-16/F-17/F-19)

### 検索（Web「全文検索」／モバイル一覧の「🔍 検索」）
- **検索対象**: タイトル・**OCR本文**・**要約テキスト**・**タグ**を横断（日本語形態素解析 kuromoji、表記ゆれ/あいまい一致対応）。
- 要約はアップロード後の非同期処理でワーカーが生成（Dify 未設定時は **kuromoji 頻度ベースの抽出要約**）し、OCR本文とともに OpenSearch へ索引する。
- 結果には**サムネイル画像**・一致箇所（本文/要約/タイトル）・ハイライト断片・カテゴリ/タグを表示する。
  **サムネイルまたはタイトルをクリックするとページビューア（ページ送り＋ズーム）で画像を確認**できる（モバイルはタップで詳細＝画像表示）。
- `GET /api/v1/search?q=...&category=...&tag=...`（タグは完全一致フィルタ）。

> **OCR/要約の精度向上**: OCRは ocrmypdf で傾き補正(deskew)・向き自動補正(osd)・汚れ除去(unpaper)・LSTMエンジン(oem=1)を適用し、
> 抽出テキストは NFKC正規化＋CJK間の余分な空白除去で整える（環境未対応時は素のOCRへ自動フォールバック）。
> 要約は Dify 未設定でも kuromoji 形態素解析の頻度スコアで重要文を抽出する（先頭数文方式から改善）。いずれもベストエフォート。

### メタデータ・タグ編集 / OCR手動修正（Web ドキュメント一覧「編集」）
- タイトル・カテゴリ・書類種別・機密度・タグ（カンマ区切り）を編集し、保存すると検索索引へ即反映。
- OCR結果の誤認識をテキスト欄で手動修正でき、修正内容も検索対象になる。
- 機密度を「機密」に変更すると保存先がオンプレ側へ再判定される（ハイブリッドストレージ, F-20）。

### ページビューア（Web ドキュメント一覧「閲覧」／全文検索の結果）
- 処理済みページを **前へ/次へ** で送り、**＋/－** でズーム、**🖨 印刷**（印刷ログを記録）。
- **「📄 OCRテキストPDF」** で、OCRで認識した文字を集約した全文PDFをダウンロードできる
  （要約が不十分な場合の代替。`GET /api/v1/documents/{id}/ocr-pdf`）。

### バージョン管理（Web ドキュメント一覧「履歴」）
- モバイル/APIから同一ドキュメントを差し替えると version が加算され、差し替え前がバージョン履歴に残る（再OCRが走る）。

---

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| Web で「一覧の取得に失敗しました」 | バックエンド未起動、または未ログイン。`docker compose ps` でbackend稼働を確認し、ログイン画面からサインインする。 |
| `Cannot connect to the Docker daemon` | Docker Desktop が未起動。`open -a Docker` で起動し、`docker info` が通るまで待つ。 |
| ログインで 500 / `password cannot be longer than 72 bytes` | `passlib` と新しい `bcrypt` の非互換。`app/backend/requirements.txt` で `bcrypt==4.0.1` に固定済み。発生時は `docker compose up -d --build backend` で再ビルド。 |
| `Port 8081 is running ...` | 別のExpoが8081を使用中。`npx expo start --port 8082` のように別ポートを指定する。 |
| 実機がExpo Goでアプリを開けない / `Project is incompatible with this version of Expo Go` | Expo Go の対応SDKがプロジェクトより古い。本プロジェクトは **Expo SDK 54**。スマホの Expo Go を App Store/Google Play で更新するか、それでも古い場合はプロジェクト側をその端末の Expo Go が対応するSDKに合わせる（`npm install expo@~54` → `npx expo install --fix`）。接続時は履歴をタップせず「Enter URL manually」で `exp://<開発機のIP>:8082` を手入力すると確実。 |
| 実機でログイン/アップロードが失敗 / 「接続先とIDをご確認ください」 | 接続先が `localhost` になっている。`localhost` は実機自身を指すため不達。`EXPO_PUBLIC_API_BASE_URL` に開発機のLAN IPを指定して `expo start`（`EXPO_PUBLIC_*` は**バンドル時に焼き込まれる**ため起動前に必須）。`app/mobile/src/api/client.ts` の既定値も LAN IP にしてある。サーバーを複数起動していると古い `localhost` バンドルに繋がることがあるので1台に統一する。 |
| アップロードが失敗 / バックエンドに `botocore...NoSuchBucket` | MinIO のバケット (`dms-cloud` / `dms-onprem`) 未作成。バックエンド起動時に `ensure_buckets()` で自動作成される（`app/backend/app/main.py`）。`docker compose down -v` 直後などで出たら `docker compose up -d backend` で再起動。 |
| アップロードは成功するが一覧のOCRが「待機中」のまま進まない | OCRワーカーが起動時にクラッシュしている可能性。`docker compose logs ocr-worker` を確認。`Unknown analyzer type [kuromoji]` が出る場合は OpenSearch に kuromoji プラグインが無い。本プロジェクトは `platform/dockerfiles/opensearch.Dockerfile` で同梱済み。素のイメージに戻っていたら `docker compose build opensearch && docker compose up -d opensearch ocr-worker`。復帰後はワーカーが待機中の文書を順次処理する。 |
| ポート競合 (5173/8000/9000/9001/5432/9200) | `platform/.env` の各 `*_PORT` を変更して再起動。 |

---

## ポート一覧

| ポート | サービス |
|---|---|
| 5173 | Web (Vite) |
| 8000 | バックエンドAPI (FastAPI) |
| 9000 / 9001 | MinIO (API / コンソール) |
| 5432 | PostgreSQL |
| 9200 | OpenSearch |
| 8082 | Expo (Metro Bundler) ※本手順での指定 |
