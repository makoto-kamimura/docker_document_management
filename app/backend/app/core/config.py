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

    # 初期管理者 (開発用シード)
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "admin123"


settings = Settings()
