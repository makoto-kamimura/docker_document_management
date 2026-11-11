# 起動・運用手順 (operation.md)

ローカル開発環境での起動手順をまとめる。構成は **バックエンド+インフラ (Docker)** / **Webアプリ (Docker)** / **モバイルアプリ (Expo, ホスト上で起動)** の3系統。

- システム概要・要件は [README.md](../../README.md) / [要件定義書](../design/requirements.md) を参照。

## 0. 前提ソフトウェア

| 用途 | ソフトウェア | 確認コマンド |
|---|---|---|
| バックエンド/インフラ/Web | Docker Desktop | `docker --version` / `docker compose version` |
| モバイル開発 | Node.js (22.13+ または 24.3+。奇数版は非対応) | `node --version` |
| モバイル実機確認 | スマホに **Expo Go** アプリ（**Expo SDK 58** 対応版。iOS 16.4+ / Android 7+） | App Store / Google Play |

> Docker Desktop は事前に起動しておく（デーモンが立ち上がるまで数十秒かかる）。
> 起動確認: `docker info` がエラーなく返ること。

## アカウントの使い分け（デモ / 実利用）

デモと実利用は**テナント**（データ分離の単位）で分かれている。テナントが違えば、
管理者であっても相手の書類・ユーザー・グループ・通知は一切見えない
（設計: [plan-tenants.md](../design/plan-tenants.md)）。

| テナント | 用途 | 初期アカウント | ロール | 公開 |
|---|---|---|---|---|
| `demo`（デモ） | お試し・デモ | `demo@example.com` / `demo123` | 管理者 | **公開** |
| `demo` | お試し・デモ | `demo-registrar@example.com` / `demo123` | 登録者 | **公開** |
| `demo` | お試し・デモ | `demo-viewer@example.com` / `demo123` | 閲覧者 | **公開** |
| `demo` | お試し・デモ | `demo-child@example.com` / `demo123` | 登録者（子供） | **公開** |
| `family`（我が家） | 実利用 | `admin@example.com` / `admin123` | 管理者 | 非公開 |
| —（所属なし） | 全体の管理 | 既存ユーザーを昇格（下記） | 全体管理者 | **非公開** |

- デモの4アカウントはデモ用グループ「デモ家族」に所属するので、**ロールごとの見え方**
  （管理者＝テナント内全件＋ユーザー/グループ/カテゴリ管理、登録者＝撮影と共有された書類、閲覧者＝閲覧のみ）と、
  **カテゴリの公開範囲**（子供には「重要書類」が見えない、「処方箋」は登録した本人だけ）をそのまま試せる。
  アカウントの案内はポートフォリオ側に載せ、ログイン画面には出さない。
- **全体管理者は公開しない**（ログイン画面にも案内を出さない）。テナントの作成やユーザーの
  テナント移動といった運用作業のときだけ使う。全体管理者も、テナント管理以外は**操作中の1つのテナントの中で**
  他のユーザーと同じように動く（テナントをまたいで一覧・検索することはない）。
- デモから実利用の書類・ユーザー・グループ・通知は一切見えない。
- **全体管理者は既定では作成しない**。運用者の既存アカウントを DB で昇格させる（テナント所属を外し、
  元のテナントを操作中のテナントにする）。`SEED_SUPER_ADMIN_EMAIL` を指定した場合のみ初回起動時に作成され、
  パスワード未設定なら `docker compose logs backend` に1度だけ表示される。操作中のテナントが未選択の
  全体管理者には、起動時に実利用テナントが割り当てられる。
- 実利用を始めるときは `admin@example.com` のパスワードを必ず変更し、家族それぞれの
  アカウントを実利用テナントに追加してグループ「家族」に入れる。

```bash
# 既存ユーザーを全体管理者に昇格させる（テナント所属を外し、元のテナントを操作中のテナントにする）
cd platform && docker compose exec postgres psql -U dms dms -c \
  "UPDATE users SET role = 'super_admin', active_tenant_id = tenant_id, tenant_id = NULL WHERE email = 'you@example.com'"
```

### 推奨: 初回起動前に実利用テナントの管理者を自分のアカウントにする

DBが空の状態（`docker compose down -v` 直後を含む）なら、`platform/.env` を先に書き換えておくと
**既定の `admin@example.com` / `admin123` を最初から作らせない**で済む。

```dotenv
SEED_ADMIN_EMAIL=you@example.com      # 実利用テナントの管理者＝自分のアカウント
SEED_ADMIN_PASSWORD=<強いパスワード>
```

> `admin@example.com` / `admin123` はこれまでデモ用として公開していた認証情報のため、
> 実利用テナントの管理者として残すと**そのテナントの書類が第三者から見えてしまう**。
> すでに作成済みの場合は、パスワードを変更するか、別の管理者を作ってから削除する。

### テナント管理（全体管理者）

全体管理者（super_admin）でログインすると、左メニューに **「テナント管理」** が表示される。
テナントの設定・確認・変更は**この画面にだけ**ある（モバイルアプリにはテナントの操作はない）。

- **作成**: 識別子（英小文字）と表示名を入力。世帯や組織を増やすときに使う。
  サンプルのカテゴリ（投函チラシ＝全員、重要書類＝子供以外、処方箋＝本人だけ）も一緒にできる。
- **操作するテナントの切替**: 一覧の「このテナントを操作」。切り替えると、ドキュメント・ユーザー・
  グループ・カテゴリ・保存先・通知がそのテナントのものだけになる。操作中のテナントはサーバーに保存され、
  モバイルアプリも同じテナントで動く（API は `PUT /api/v1/tenants/active`）。未選択のあいだは
  テナント管理以外の画面に案内が出て、API は 409 を返す。
- **メンバーの確認と移動**: 一覧の「メンバー」でそのテナントのユーザーを確認し、「移動先」を選ぶ。
  本人が登録したドキュメントと通知も一緒に移り、テナントをまたぐグループ所属・個別共有は解除される。
  他人の書類についての通知は移さずに消える（元のテナントの書類のタイトルを移動先へ持ち出さないため）。
  テナント最後の管理者は移せない。
- **削除**: ユーザーもドキュメントも無い**空のテナント**だけ削除できる（カテゴリは一緒に消える）。

> 既存DBからのアップグレード時は、テナント導入前のデータが**実利用テナント**（`family`）へ
> まとめて移行される。デモ側へ寄せたい場合は初回起動前に `SEED_LEGACY_TENANT_SLUG=demo` を
> 設定するか、起動後に「テナント管理」の「メンバー」からユーザーを移動する。

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
  -d "username=demo@example.com&password=demo123" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/documents
```

### 補足

- バックエンドは起動時に **DBテーブルの自動作成**・**テナント移行**・**初期ユーザーの投入**を行う
  （`app/backend/app/db/seed.py` / `app/backend/app/db/migrate.py`）。既存DBには `tenant_id` 列が
  追加され、テナント導入前のデータは実利用テナントへ割り当てられる（冪等）。
  カテゴリ導入前のDBでは、今あるテナントにサンプルのカテゴリが作られ、旧カテゴリの文字列は
  書類種別（書類種別があればタグ）へ移り、書類は未分類（これまでどおりの共有範囲）になる。
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

> 本アプリは **Expo SDK 58**（React Native 0.88 / React 19.3）。スマホの Expo Go が対応するSDKと一致している必要がある（不一致だと `Project is incompatible with this version of Expo Go`）。端末の Expo Go が古い場合は App Store / Google Play で更新する。ストアの SDK 58 版 Expo Go は SDK 58 専用で、SDK 57 以前のアプリは開けない。ストアの Expo Go が SDK 58 に対応していない場合は、iOS 実機は `eas go`、Android は `npx expo start` 実行中に `a` キーで SDK 58 対応版の Expo Go を入れられる。

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

1. **ログイン画面** … デモは `admin@example.com` / `admin123`、実利用はご自分のアカウントでサインイン (F-33)。
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
7. 詳細画面の**画像をタップ** … 全画面表示。ピンチ・ダブルタップで拡大し、拡大中は指で動かせる（× で閉じる）。
8. 詳細画面の **「この書類を削除」**（所有者・管理者・削除可を付与された人だけに表示）… 確認のあと書類を**完全に削除**して一覧へ戻る。
   ページ画像・PDF・コメント・家族の確認状況もすべて消え、元に戻せない（D18）。
8. 詳細画面の**下のバー** … コメントを書いて ➤ で送る。「あなたの対応」のアイコン（確認した / 対応する / 対応済み / あとで確認）を
   押すと、入力中のコメントも送って対応を保存し、開く前の一覧へ戻る。
9. 各タブのヘッダー右の**名前** … アカウント画面。表示名の変更とログアウト。

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

> 要約機能（要約PDF・Dify 連携）は 2026-11 に廃止した。既存の `.env` に `DIFY_*` が残っていても無視される。
> ストレージに残っている `{id}/summary.txt` はどこからも読まれないので、消さなくてよい。

### 関連APIエンドポイント（補足）

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/v1/documents` | 複数ページ(`files`)＋`mode`(color/gray/bw)＋`category_id`(任意)で登録（複数ページ=1ドキュメント） |
| GET | `/api/v1/documents/{id}/content` | 処理済みプレビュー画像を返す（未処理は生ページにフォールバック） |
| GET | `/api/v1/documents/{id}/quality` | 画質チェック結果（ブレ/暗さ/影/解像度の警告） |
| GET | `/api/v1/documents/{id}/document-pdf` | ワーカーが生成・保存した検索可能PDF（電子資料）を返す（未生成は 404） |
| GET | `/api/v1/documents/{id}/ocr-pdf` | **OCRで認識した文字を集約した全文PDF**を生成して返す（OCR未完了は 409） |
| PATCH | `/api/v1/documents/{id}` | メタデータ（タイトル/カテゴリ `category_id`/書類種別/機密度/タグ）・OCRテキストの編集→再索引（編集権限） |
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
見えるのは**操作中のテナントのユーザーだけ**（全体管理者も同じ。テナント間の移動は「テナント管理」で行う）。

### ユーザーのマスタ管理
- **追加**: 「＋ ユーザーを追加」→ メール/氏名/ロール/子供/初期パスワード（管理者が設定）。
  作成されるユーザーは操作中のテナントに所属する。
- **ロール変更**: 一覧の行内セレクトで 管理者/登録者/閲覧者 を切替。
- **子供**: 一覧のチェックで切り替える。子供の印がある人は、公開範囲が「子供以外」のカテゴリの書類を見られない
  （ロールとは別。子供でも登録者なら撮影できる）。
- **PWリセット / 削除**: 各行のボタンから。
- ガード: 自分自身のロール変更・削除、**テナント内で最後の管理者**の降格・削除は不可
  （サーバー側でも拒否）。全体管理者ロールの付与・解除・削除は画面/APIからは行えない。

### ドキュメント単位のアクセス権限（ACL）
- 「ドキュメント一覧」各行の **「権限設定」**（管理者またはそのドキュメントの所有者のみ表示）。
- ユーザーごとに **権限なし / 閲覧のみ / 編集可 / 削除可** を設定。所有者と管理者は常にフル権限。
- 付与されていないユーザーには、一覧・閲覧・PDF取得が**非表示/404**になる。
- **削除可**の人・所有者・管理者には、一覧の行の **ゴミ箱** とビューアの **「削除」** が表示される。
  確認のあと書類を**完全に削除**する（ページ画像・PDF・検索索引・コメント・通知・閲覧ログもまとめて消え、元に戻せない）。
- カテゴリの公開範囲を超えては共有できない（「本人だけ」の書類は誰に付与しても見えず、
  「子供以外」の書類は子供に付与しても見えない）。

### カテゴリと公開範囲（F-17/F-39）
- 左メニュー **「カテゴリ管理」**（管理者のみ）でカテゴリを追加し、**見られる人**を選ぶ。
  名前の変更・見られる人の変更・削除（書類が入っていないものだけ）もここで行う。

  | 見られる人 | 内容 |
  |---|---|
  | 全員 | テナントの全員 |
  | 子供以外 | 子供の印が付いた人は見られない（登録した本人は見られる） |
  | 家族 | 登録した人・同じグループの家族・個別に共有した人・管理者（カテゴリを選ばない書類も同じ） |
  | 本人だけ | 登録した本人だけ（**管理者・全体管理者も見られない**） |

- 見られる人はその中の書類を見られる上限で、一覧・詳細・検索・通知・ログのすべてに当てはまる。
  範囲を変えると、登録済みの書類にもすぐに反映される（広げるときは確認が出る）。
- 書類のカテゴリは、モバイルの撮影の確認画面で選ぶか、Web の「編集」で変える。
- 新しいテナントには、サンプルの「投函チラシ（全員）」「重要書類（子供以外）」「処方箋（本人だけ）」が用意される。

### グループと自動共有 (F-36)
- 左メニュー **「グループ管理」**（管理者のみ）でグループを作成し、**メンバー管理**で所属ユーザーを追加/削除。
- グループは**テナント内に閉じる**（別テナントのユーザーはメンバーに追加できない）。
  グループ名はテナント内で一意なので、別の世帯が同じ「家族」という名前を使える。
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
| PATCH/DELETE | `/api/v1/users/{id}` | 更新（氏名/ロール/子供 `is_child`）/ 削除（**管理者限定**） |
| POST | `/api/v1/users/{id}/password` | パスワードリセット（**管理者限定**） |
| GET/POST | `/api/v1/groups` | グループ一覧 / 作成（**管理者限定**） |
| PATCH/DELETE | `/api/v1/groups/{id}` | グループ更新 / 削除（**管理者限定**） |
| GET | `/api/v1/groups/{id}/members` | グループ所属メンバー一覧（**管理者限定**） |
| PUT/DELETE | `/api/v1/groups/{id}/members/{userId}` | メンバー追加 / 削除（**管理者限定**） |
| DELETE | `/api/v1/documents/{id}` | 書類の完全削除（所有者/管理者/削除可。元に戻せない） |
| GET | `/api/v1/documents/{id}/permissions` | ドキュメントのACL一覧（管理者/所有者） |
| PUT/DELETE | `/api/v1/documents/{id}/permissions/{userId}` | ACL の付与・変更 / 解除（管理者/所有者） |
| GET | `/api/v1/documents/{id}/reads` | 既読者一覧（誰がいつ, 管理者/所有者） |
| GET | `/api/v1/categories` | カテゴリ一覧（自分が見られる書類の件数つき） |
| POST | `/api/v1/categories` | カテゴリ追加（名前・見られる人。**管理者限定**） |
| PATCH/DELETE | `/api/v1/categories/{id}` | カテゴリ更新 / 削除（**管理者限定**・書類が無いもののみ削除可） |
| GET/POST | `/api/v1/tenants` | テナント一覧 / 作成（**全体管理者限定**） |
| PATCH/DELETE | `/api/v1/tenants/{id}` | テナント更新 / 削除（**全体管理者限定**・空のみ削除可） |
| PUT | `/api/v1/tenants/active` | 操作するテナントの切り替え（**全体管理者限定**） |
| GET | `/api/v1/tenants/{id}/users` | テナントのメンバー一覧（**全体管理者限定**） |
| PUT | `/api/v1/tenants/{id}/users/{userId}` | ユーザーをこのテナントへ移動（**全体管理者限定**） |

> ロール: `super_admin`(全体管理者) / `admin`(管理者) / `registrar`(登録者) / `viewer`(閲覧者)。
> 権限レベル: `view` < `edit` < `delete`（上位は下位を包含）。
> すべての一覧・検索・通知はテナントとカテゴリの公開範囲で絞り込まれ、別テナントのリソースと見られない書類は存在を伏せて 404 を返す。
> 全体管理者は操作中のテナントの中だけで動く（切り替えは `PUT /api/v1/tenants/active`。`X-Tenant-Id` ヘッダは使わない）。
> ドキュメント一覧 `GET /api/v1/documents` は各件に現在ユーザー基準の `is_read`・`can_delete` と `tags` を含む。

---

## 4.5 家族での共有・通知（紙を見逃さない）

撮影した紙は OCR 後に自動で解析され、**重要度・期限・対象**が付いて家族に通知される。

### 使い方

1. **家族を作る**: Web「グループ管理」でグループ（例: 山田家）を作り、家族を追加する。
   同じグループのメンバーは、誰が撮影した紙も自動で見られる。
2. **撮る**: モバイルで紙を撮影する。読み取りが終わると家族に通知が届く
   （タイトルは見出しから自動で付く。例: `資料_1757…` → 「運動会の出欠についてのお願い」）。
3. **確認する**: お知らせ（モバイル=🔔 / Web=サイドバー「お知らせ」）から開く。
   開いた時点で既読になる。「確認した / 対応する / 対応済み / あとで確認」を選べる。
4. **知らせる**: 未確認の家族には「もう一度通知」。未確認が複数なら全員にまとめて送れる。
5. **やりとり**: コメントで「出欠票は提出済み」などを共有できる（他の家族に通知される）。

### 自動の通知

| 種類 | タイミング |
|---|---|
| 新しい紙 | OCR・解析の完了時に1回（登録者以外の家族へ） |
| リマインド | 重要 or 期限つきで未確認の人へ `REMINDER_INTERVAL_HOURS`（既定24時間）ごと、最大 `REMINDER_MAX_COUNT`（既定3回）。**全員が確認したら停止** |
| 期限が近い | 期限の `DEADLINE_NOTICE_DAYS`（既定1日）前に1回。「対応する」の人がいればその人へ／誰かが「対応済み」なら送らない |
| コメント | コメント追加時に他の家族へ |

判定は OCR ワーカーが10分ごとに実行する。設定は `platform/.env` を参照。

> **解析を直す**: 期限や重要度が違うときは Web「編集」で修正できる。修正後は自動解析で上書きされない。

### 関連APIエンドポイント

- `GET /api/v1/documents/{id}/family` … 解析結果 + 家族それぞれの既読・対応状況
- `PUT /api/v1/documents/{id}/action` … 自分の対応状況（`seen` / `will_do` / `done` / `later`）
- `PUT /api/v1/documents/{id}/insight` … 重要度・期限・対象の手動修正（編集権限）
- `POST /api/v1/documents/{id}/notify` … もう一度通知（`user_id` 未指定なら未確認の全員）
- `GET/POST /api/v1/documents/{id}/comments` … コメント
- `GET /api/v1/notifications` / `…/unread-count` / `POST …/{id}/read` / `POST …/read-all`
- `POST/DELETE /api/v1/push-tokens` … 端末のプッシュトークン登録・解除

> プッシュ通知は端末が Expo Push Token を登録したときだけ送られる（[app/mobile/README.md](../../app/mobile/README.md)）。
> 本文に書類の中身は含めない。`PUSH_ENABLED=false` で外部送信を止められる（アプリ内通知は残る）。

## 4.6 書類の保存先（外部ストレージ連携） (F-20a)

テナントの管理者が Web の **「保存先」**（`/storage`）で、書類の画像・PDF の保存先を選ぶ。
使用中の保存先は**これから登録する書類**に使われ、登録済みの書類は元の保存先から読み込む。
機密書類は「自宅内（オンプレ）」にした保存先にだけ置き、それ以外はサーバー内の MinIO に置く。
デモテナントでは変更できない。

### サーバー側の準備（最初に1回）

`platform/.env`（本番は compose の environment）に暗号鍵を設定し、`backend` と `ocr-worker` の両方に渡す。

```bash
# 鍵を作る（一度決めたら変えない。変えると登録済みの保存先を復号できなくなる）
docker compose exec backend python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

```dotenv
STORAGE_SECRET_KEY=<上で出力された値>
```

設定後 `docker compose up -d backend ocr-worker` で反映する。未設定だと保存先画面に警告が出て登録できない。

### Cloudflare R2

1. Cloudflare ダッシュボード → **R2** → バケットを作成（例: `kamilog`）。
2. **R2 → API トークンを管理** → 「API トークンを作成」。権限は **オブジェクトの読み取りと書き込み**、対象は作ったバケットだけにする。
3. 表示された **アクセスキー ID / シークレットアクセスキー** と、R2 概要ページの **アカウント ID** を控える。
4. Web の「保存先」→ **＋ Cloudflare R2** に入力 →「保存して接続テスト」→ 成功したら「この保存先を使う」。

### Google ドライブ

サーバー側で OAuth クライアントを1つ用意すれば、各テナントは自分の Google アカウントのドライブと連携できる。

1. [Google Cloud コンソール](https://console.cloud.google.com/) でプロジェクトを作り、**Google Drive API** を有効にする。
2. **OAuth 同意画面**を設定する（スコープは `.../auth/drive.file` と `openid` `email`）。公開ステータスが「テスト」の間は、テストユーザーに登録したアカウントだけが連携できる。
3. **認証情報 → OAuth クライアント ID を作成**（種類: ウェブ アプリケーション）。承認済みのリダイレクト URI に次を登録する:
   ```
   https://<バックエンドのドメイン>/api/v1/storage/google/callback
   ```
4. `.env` に設定して再起動する:
   ```dotenv
   GOOGLE_OAUTH_CLIENT_ID=<クライアント ID>
   GOOGLE_OAUTH_CLIENT_SECRET=<クライアント シークレット>
   GOOGLE_OAUTH_REDIRECT_URI=https://<バックエンドのドメイン>/api/v1/storage/google/callback
   WEB_BASE_URL=https://<Web のドメイン>
   ```
5. Web の「保存先」→ **＋ Google ドライブと連携** → Google で許可 → 保存先画面に戻り「この保存先を使う」。

- ドライブには「紙ログ」フォルダができ、その下に書類ごとのフォルダが作られる。アプリは自分が作ったファイルにしか触れない（`drive.file`）。
- 「要再連携」と表示されたら（Google 側で許可を取り消した等）、**再連携**ボタンで**同じアカウント**で許可し直す。別のアカウントでは保存済みの書類を読めないため断る。

### Synology NAS（WebDAV）

1. DSM の **パッケージセンター** で **WebDAV Server** をインストールし、**HTTPS を有効**にする（既定ポート 5006）。
2. 保存用の共有フォルダ（例: `kamilog`）と、そのフォルダだけに読み書き権限を持つユーザーを作る。
3. バックエンドから NAS に届く URL を確かめる。自宅外のサーバーから使う場合は VPN / Tailscale / DDNS + ルーターのポート開放のいずれかで 5006 に届くようにする。
   ```bash
   docker compose exec backend python -c "import httpx; print(httpx.request('PROPFIND', 'https://<NAS>:5006/kamilog/', auth=('<ユーザー>','<パスワード>'), headers={'Depth':'0'}, verify=False).status_code)"   # 207 なら OK
   ```
4. Web の「保存先」→ **＋ Synology NAS** に URL（例: `https://nas.local:5006/kamilog`）・ユーザー・パスワードを入力する。
   - 自己署名証明書のままなら「証明書を検証する」を外す（Let's Encrypt 等の正式な証明書を推奨）。
   - 「自宅内（オンプレ）の保存先として扱う」をオンにすると機密書類もここへ保存する。
5. 「保存して接続テスト」→ 成功したら「この保存先を使う」。

### 関連APIエンドポイント

- `GET /api/v1/storage` … 保存先の一覧・使用中・サーバーの準備状況
- `POST /api/v1/storage/backends` / `PATCH|DELETE …/{id}` / `POST …/{id}/test` … 登録・変更・削除・接続テスト
- `PUT /api/v1/storage/active` … 使用中の保存先を切り替える（`{"backend_id": null}` で既定に戻す）
- `GET /api/v1/storage/google/authorize` / `GET …/google/callback` … Google ドライブ連携

## 5. 全文検索・OCR の精度・メタデータ・バージョン (F-23〜F-26, F-13, F-16/F-17/F-19)

### 検索（Web「全文検索」／モバイル一覧の「🔍 検索」）
- **検索対象**: タイトル・**OCR本文**・**タグ**を横断（日本語形態素解析 kuromoji、表記ゆれ/あいまい一致対応）。
- **OCR の読み違い**: 2文字ずつの区切り（`.ngram`）でも索引し、数文字読み違えた本文にも当たる（例: 本文が「保護着会」でも「保護者会」で見つかる）。
- **ひらがな入力**: 読み（カタカナ）でも索引し、「うんどうかい」で「運動会」が見つかる。読みは索引時に kuromoji で付ける。
- 結果には**サムネイル画像**・一致箇所（本文/タイトル）・ハイライト断片・カテゴリ/タグを表示する。
  **サムネイルまたはタイトルをクリックするとページビューア（ページ送り＋ズーム）で画像を確認**できる（モバイルはタップで詳細＝画像表示）。
- `GET /api/v1/search?q=...&category_id=...&tag=...`（タグは完全一致フィルタ）。
- **閲覧範囲**: 自分のテナント内で、かつ閲覧できる書類（カテゴリの公開範囲・共有・グループ）だけがヒットする
  （閲覧できる書類の ID を DB で求めて索引を絞り、返す直前にも DB で再確認する二重の防御）。

> **OCR の精度向上**: OCRは ocrmypdf で傾き補正(deskew)・向き自動補正(osd)を適用し、認識モデルは高精度版 `tessdata_best`
> （ocr-worker イメージで導入）を使う。OCR に渡す画像だけに影・照明ムラ除去と低解像度時の拡大をかける（`services/ocr_plugin.py`。
> PDF に載る表示用画像は変えない）。抽出テキストは NFKC正規化・CJK間の余分な空白除去・カタカナの誤認識補正（一→ー、口→ロ など）で整える。
> 画像のページの**本文は PaddleOCR（PP-OCRv6 small、RapidOCR + ONNX Runtime）で読み**、読めなかったページは Tesseract の結果を使う。
> 検索可能 PDF のテキスト層は Tesseract のまま。PaddleOCR は別プロセスで動かすので、終わればメモリは戻る（ピーク約 570MB）。
> どのページをどちらで読んだかは `{id}/quality.json` の `ocr_engine`。白黒モードは、グレーで OCR してから PDF の画像だけを白黒にする。
> **反映には ocr-worker の再ビルドが必要**（`docker compose build ocr-worker`）。PaddleOCR のモデルはビルド時に取り込む。

### 検索の索引の移行（N-gram・読みの追加）

- 新しい解析器を既存の索引に足すには、索引を一度閉じる必要がある。**OCR ワーカーの起動時**に自動で行い、数秒だけ検索できなくなる。
  続けて既存の文書を索引し直す（`[search] reindexed for new subfields: N` がログに出る）。
- 読み（ひらがな検索用）は OCR ワーカーが起動直後と10分ごとに、まだ入っていない文書へ入れていく（`[ocr-worker] backfilled search reading: N`）。
- OCR の再実行は要らない（本文は索引と DB にあるものを使う）。

### 本文を読む OCR エンジンの設定

```
OCR_TEXT_ENGINE=paddle        # tesseract にすると Tesseract だけで読む
OCR_PADDLE_PRESET=v6-small    # app/services/paddle_ocr.py の PRESETS。ビルド引数 PADDLE_OCR_PRESET と合わせる
OCR_PADDLE_MAX_SIDE=1600      # 長辺をこの大きさまで縮めて読む（大きいほどメモリを使う。2000 で約 750MB）
```

モデルを変えるときは `docker compose build --build-arg PADDLE_OCR_PRESET=v6-medium ocr-worker` のようにビルドし直す
（v6-medium は誤り率がさらに低いがメモリ約 1.4GB・1ページ約12秒）。

### OCR の精度評価（方式を変えるとき）

`app/backend/scripts/ocr_eval.py` で、合成サンプル（スマホで撮った書類写真に似せた画像と正解テキスト）を作り、
方式ごとの文字誤り率（CER）・1ページの秒数・PaddleOCR の最大メモリを比べる。実物の写真も `xxx.jpg` と正解 `xxx.txt` を
同じフォルダに置けば一緒に測れる。

```bash
# 評価用イメージ（ocr-worker に CJK フォントを足したもの。rapidocr は ocr-worker に入っている）
# FROM は `docker compose build ocr-worker` で作ったイメージ（既定の名前は platform-ocr-worker。docker images で確認）
cat > /tmp/ocreval.Dockerfile <<'DOCKER'
FROM platform-ocr-worker
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
DOCKER
docker build -t dms-ocr-eval -f /tmp/ocreval.Dockerfile .
cd app/backend
docker run --rm -v $PWD:/app -v /tmp/ocrwork:/work -w /app dms-ocr-eval python scripts/ocr_eval.py synth --out /work/samples --n 12
docker run --rm -v $PWD:/app -v /tmp/ocrwork:/work -w /app dms-ocr-eval python scripts/ocr_eval.py run --samples /work/samples --out /work/result
cat /tmp/ocrwork/result/report.md
```

### メタデータ・タグ編集 / OCR手動修正（Web ドキュメント一覧「編集」）
- タイトル・カテゴリ（カテゴリ管理にあるものから選ぶ。見られる人も変わる）・書類種別・機密度・タグ（カンマ区切り）を編集し、保存すると検索索引へ即反映。
- OCR結果の誤認識をテキスト欄で手動修正でき、修正内容も検索対象になる。
- 機密度を「機密」に変更すると保存先がオンプレ側へ再判定される（ハイブリッドストレージ, F-20）。

### ページビューア（Web ドキュメント一覧「閲覧」／全文検索の結果）
- 処理済みページを **前へ/次へ** で送り、**＋/－** でズーム、**🖨 印刷**（印刷ログを記録）。
- **「📄 OCRテキストPDF」** で、OCRで認識した文字を集約した全文PDFをダウンロードできる
  （`GET /api/v1/documents/{id}/ocr-pdf`）。

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
| 実機がExpo Goでアプリを開けない / `Project is incompatible with this version of Expo Go` | Expo Go の対応SDKがプロジェクトと違う。本プロジェクトは **Expo SDK 57**。スマホの Expo Go を App Store/Google Play で更新する（ストア版が対応していなければ [3章](#3-モバイルアプリ-expo--実機) の `eas go` / `a` キーの方法で入れる）。接続時は履歴をタップせず「Enter URL manually」で `exp://<開発機のIP>:8082` を手入力すると確実。 |
| 実機でログイン/アップロードが失敗 / 「接続先とIDをご確認ください」 | 接続先が `localhost` になっている。`localhost` は実機自身を指すため不達。`EXPO_PUBLIC_API_BASE_URL` に開発機のLAN IPを指定して `expo start`（`EXPO_PUBLIC_*` は**バンドル時に焼き込まれる**ため起動前に必須）。`app/mobile/src/api/client.ts` の既定値は本番ドメインのため、ローカル開発では必ず指定する。サーバーを複数起動していると古い `localhost` バンドルに繋がることがあるので1台に統一する。 |
| アップロードが失敗 / バックエンドに `botocore...NoSuchBucket` | MinIO のバケット (`dms-cloud` / `dms-onprem`) 未作成。バックエンド起動時に `ensure_buckets()` で自動作成される（`app/backend/app/main.py`）。`docker compose down -v` 直後などで出たら `docker compose up -d backend` で再起動。 |
| アップロードは成功するが一覧のOCRが「待機中」のまま進まない | OCRワーカーが起動時にクラッシュしている可能性。`docker compose logs ocr-worker` を確認。`Unknown analyzer type [kuromoji]` が出る場合は OpenSearch に kuromoji プラグインが無い。本プロジェクトは `platform/dockerfiles/opensearch.Dockerfile` で同梱済み。素のイメージに戻っていたら `docker compose build opensearch && docker compose up -d opensearch ocr-worker`。復帰後はワーカーが待機中の文書を順次処理する。 |
| 保存先画面に「STORAGE_SECRET_KEY が設定されていない」/ OCR が失敗し、ワーカーのログに `STORAGE_SECRET_KEY が未設定` | 暗号鍵が未設定。`backend` と `ocr-worker` の**両方**に同じ `STORAGE_SECRET_KEY` を渡して再起動する（[4.6節](#46-書類の保存先外部ストレージ連携-f-20a)）。 |
| 保存先が「接続エラー」/ アップロードが 503「保存先に書き込めませんでした」 | 保存先に届かない・認証が通らない。保存先画面のバッジにカーソルを当てると理由が出る。パスワードやキーを変えたら「編集」で入れ直す。NAS はバックエンドから URL に届くか（VPN 等）を確認。端末は送信待ちに残るので、直れば「未送信N件を同期」で再送できる。 |
| Google ドライブが「要再連携」 | Google 側で許可が取り消された、またはリフレッシュトークンが失効した。保存先画面の「再連携」で同じアカウントで許可し直す。 |
| Google 連携後に「連携の有効期限が切れました」 | 同意画面で10分以上経った。もう一度「Google ドライブと連携」から始める。`GOOGLE_OAUTH_REDIRECT_URI` が Google Cloud に登録した値と一致しているかも確認する。 |
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
