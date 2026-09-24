from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """環境変数から読み込むアプリ設定。"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Document Management System"
    api_v1_prefix: str = "/api/v1"

    # DB
    database_url: str = "postgresql+psycopg://dms:dms_password@localhost:5432/dms"

    # 検索
    opensearch_url: str = "http://localhost:9200"
    search_index: str = "documents"

    # ストレージ (S3互換)
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_cloud: str = "dms-cloud"      # 非機密
    s3_bucket_onprem: str = "dms-onprem"    # 機密（オンプレ相当）

    # 認証
    jwt_secret: str = "change_me_in_production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # OCR（縦書き jpn_vert + 横書き jpn + 英数 eng。traineddata は worker イメージに導入済）
    ocr_lang: str = "jpn+jpn_vert+eng"

    # 要約 (Dify)。dify_api_key 未設定時はルールベース簡易要約にフォールバックする。
    dify_api_base: str = "https://api.dify.ai/v1"   # 自己ホスト時は http://<host>/v1 等
    dify_api_key: str = ""
    dify_app_type: str = "completion"               # completion | workflow
    dify_input_var: str = "text"                    # Difyアプリの入力変数名
    dify_output_var: str = "summary"                # workflow時の出力ノード変数名
    summary_max_chars: int = 4000                   # Difyへ送る/フォールバック要約の上限文字数

    # 家族への通知 (アプリ内通知 + Expo プッシュ)
    # プッシュは端末が Expo Push Token を登録したときだけ送る（EAS の projectId を設定したアプリのみ登録される）。
    # プッシュ本文には書類の中身を載せない（Expo/Apple/Google のサーバーを経由するため）。
    push_enabled: bool = True
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"
    expo_access_token: str = ""          # Expo の「Enhanced Security for Push」を使う場合のみ
    reminder_interval_hours: int = 24    # 未確認の家族へのリマインド間隔
    reminder_max_count: int = 3          # 1人・1書類あたりのリマインド上限
    deadline_notice_days: int = 1        # 期限の何日前に「期限が近い」通知を送るか
    renotify_cooldown_minutes: int = 5   # 同じ相手への「もう一度通知」の連打防止
    tz_offset_hours: int = 9             # 期限判定に使うタイムゾーン（日本時間）

    # ---- テナント (データ分離の単位) ----
    # 起動時に「実利用」と「デモ」の2テナントを用意する。デモ用アカウントは公開しているため、
    # 実利用の書類が見えないようテナントを分ける。
    tenant_primary_slug: str = "family"
    tenant_primary_name: str = "我が家"
    tenant_demo_slug: str = "demo"
    tenant_demo_name: str = "デモ"
    # テナント導入前からあるデータ（ユーザー/グループ/ドキュメント）の移行先テナント。
    # 既定は実利用テナント。デモへ寄せたい場合は "demo" を指定する。
    seed_legacy_tenant_slug: str = "family"

    # 初期ユーザー (開発用シード)
    # 全体管理者: テナントに属さずすべてのテナントを管理できる**非公開**アカウント。
    # パスワード未設定なら起動時に自動生成してログへ1度だけ出力する。
    # メールを空にすると作成しない（運用者が自分で作る場合）。
    seed_super_admin_email: str = "super@example.com"
    seed_super_admin_password: str = ""
    # 実利用テナントの管理者
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "admin123"

    # デモテナントの公開アカウント（ログイン画面に案内を出す）。
    # ロールごとの見え方を試せるよう 管理者/登録者/閲覧者 の3つを用意し、同じグループに入れる。
    # 空にしたアカウントは作成しない。パスワードは3つ共通。
    seed_demo_password: str = "demo123"
    seed_demo_admin_email: str = "demo@example.com"
    seed_demo_registrar_email: str = "demo-registrar@example.com"
    seed_demo_viewer_email: str = "demo-viewer@example.com"
    seed_demo_group_name: str = "デモ家族"


settings = Settings()
