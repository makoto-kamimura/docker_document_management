"""保存先の実装（S3 互換 / WebDAV / Google ドライブ）と、登録内容からの組み立て。"""

from app.core.config import settings
from app.core.crypto import SecretKeyMissing, decrypt_json
from app.models.storage_backend import StorageBackend, StorageKind
from app.services.storage_backends.base import (
    ObjectStore, StorageAuthError, StorageError, StorageNotFound,
)
from app.services.storage_backends.gdrive import GoogleDriveStore
from app.services.storage_backends.s3 import S3Store, r2_endpoint
from app.services.storage_backends.webdav import WebDAVStore

DEFAULT_PREFIX = "dms/"

__all__ = [
    "ObjectStore", "StorageAuthError", "StorageError", "StorageNotFound",
    "GoogleDriveStore", "S3Store", "WebDAVStore", "build_store", "DEFAULT_PREFIX",
]


def build_store(backend: StorageBackend) -> ObjectStore:
    """DB に登録された保存先から ObjectStore を作る（認証情報はここで復号する）。"""
    cfg = backend.config or {}
    try:
        secret = decrypt_json(backend.secret_encrypted)
    except SecretKeyMissing as exc:
        raise StorageError(str(exc)) from exc
    prefix = cfg.get("prefix", DEFAULT_PREFIX)
    if backend.kind == StorageKind.s3:
        endpoint = cfg.get("endpoint") or (
            r2_endpoint(cfg["account_id"]) if cfg.get("account_id") else None
        )
        return S3Store(
            endpoint=endpoint,
            access_key=secret.get("access_key", ""),
            secret_key=secret.get("secret_key", ""),
            bucket=cfg["bucket"],
            region=cfg.get("region") or ("auto" if cfg.get("account_id") else None),
            prefix=prefix,
        )
    if backend.kind == StorageKind.webdav:
        return WebDAVStore(
            url=cfg["url"],
            username=secret.get("username", ""),
            password=secret.get("password", ""),
            prefix=prefix,
            verify_tls=cfg.get("verify_tls", True),
        )
    if backend.kind == StorageKind.gdrive:
        if not settings.google_oauth_client_id:
            raise StorageError("Google ドライブ連携がサーバーで設定されていません (GOOGLE_OAUTH_CLIENT_ID)")
        return GoogleDriveStore(
            client_id=settings.google_oauth_client_id,
            client_secret=settings.google_oauth_client_secret,
            refresh_token=secret.get("refresh_token", ""),
            folder_id=cfg.get("folder_id"),
            # ドライブ上は「紙ログ」フォルダの中に書類ごとのフォルダを作るので接頭辞は付けない
            prefix=cfg.get("prefix", ""),
        )
    raise StorageError(f"未対応の保存先です: {backend.kind}")
