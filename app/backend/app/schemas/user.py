import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import Role


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    role: Role
    tenant_id: uuid.UUID | None = None   # super_admin は None
    tenant_name: str | None = None       # 表示用（一覧/認証情報で付与）
    created_at: datetime


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=100)
    role: Role = Role.viewer
    password: str = Field(min_length=4, max_length=72)
    # 所属テナント。テナント管理者は自分のテナント固定、super_admin のみ指定できる
    tenant_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    """部分更新。指定された項目のみ反映する。"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: Role | None = None
    # テナントの移動は super_admin のみ（所有ドキュメント・通知も一緒に移る）
    tenant_id: uuid.UUID | None = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=4, max_length=72)
