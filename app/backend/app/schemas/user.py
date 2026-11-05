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
    # 所属テナント。super_admin は所属しないため None（/auth/me では操作中のテナントを返す）
    tenant_id: uuid.UUID | None = None
    tenant_name: str | None = None       # 表示用（一覧/認証情報で付与）
    is_child: bool = False               # 子供（公開範囲「子供以外」の書類を見られない）
    created_at: datetime


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=100)
    role: Role = Role.viewer
    password: str = Field(min_length=4, max_length=72)
    is_child: bool = False


class UserUpdate(BaseModel):
    """部分更新。指定された項目のみ反映する。"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: Role | None = None
    is_child: bool | None = None


class MeUpdate(BaseModel):
    """自分の情報の変更（ログイン中の本人なら誰でも）。今は表示名だけ。"""

    name: str = Field(min_length=1, max_length=100)


class PasswordReset(BaseModel):
    password: str = Field(min_length=4, max_length=72)
