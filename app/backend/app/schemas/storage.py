import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# 画面で選ぶ種類。Google ドライブは OAuth の連携で作るためここには含めない
ManualPreset = Literal["r2", "s3", "synology"]


class StorageBackendRead(BaseModel):
    """保存先。認証情報そのものは返さない（登録済みかどうかだけ）。"""

    id: uuid.UUID
    kind: str
    preset: str
    name: str
    config: dict
    is_onprem: bool
    has_secret: bool
    is_active: bool
    document_count: int = 0
    last_test_ok: bool | None = None
    last_test_error: str | None = None
    last_tested_at: datetime | None = None
    created_at: datetime


class StorageOverview(BaseModel):
    active_backend_id: uuid.UUID | None
    backends: list[StorageBackendRead]
    # サーバー側の準備状況（未設定なら画面で案内する）
    secret_key_configured: bool
    google_enabled: bool
    # デモテナントは保存先を変更できない
    editable: bool


class StorageBackendCreate(BaseModel):
    preset: ManualPreset
    name: str = Field(min_length=1, max_length=100)
    config: dict = Field(default_factory=dict)
    secret: dict = Field(default_factory=dict)
    is_onprem: bool = False


class StorageBackendUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    config: dict | None = None
    # 指定した項目だけ差し替える（空文字の項目は登録済みの値を据え置く）
    secret: dict | None = None
    is_onprem: bool | None = None


class ActiveStorageUpdate(BaseModel):
    backend_id: uuid.UUID | None = None  # None で既定の保存先 (MinIO) に戻す


class StorageTestResult(BaseModel):
    ok: bool
    error: str | None = None
    backend: StorageBackendRead


class AuthorizeUrl(BaseModel):
    url: str
