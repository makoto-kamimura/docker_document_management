"""保存先の認証情報（アクセスキー・パスワード・リフレッシュトークン）の暗号化。

DB には Fernet で暗号化した文字列だけを保存し、平文は API レスポンスにもログにも出さない。
鍵は環境変数 `STORAGE_SECRET_KEY`。鍵を変えると既存の保存先は復号できなくなる（再登録が必要）。
"""

import json

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class SecretKeyMissing(RuntimeError):
    """STORAGE_SECRET_KEY が未設定、または不正。"""


def _fernet() -> Fernet:
    if not settings.storage_secret_key:
        raise SecretKeyMissing(
            "STORAGE_SECRET_KEY が未設定のため、外部の保存先を使えません。"
            "サーバーの .env に設定してください（バックエンドと OCR ワーカーの両方）"
        )
    try:
        return Fernet(settings.storage_secret_key.encode())
    except ValueError as exc:
        raise SecretKeyMissing("STORAGE_SECRET_KEY の形式が不正です（Fernet 鍵を指定してください）") from exc


def encrypt_json(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data, ensure_ascii=False).encode()).decode()


def decrypt_json(token: str | None) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(token.encode()))
    except InvalidToken as exc:
        raise SecretKeyMissing(
            "保存先の認証情報を復号できません（STORAGE_SECRET_KEY が変わった可能性があります）"
        ) from exc
