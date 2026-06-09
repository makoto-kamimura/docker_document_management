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
    created_at: datetime


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=100)
    role: Role = Role.viewer
    password: str = Field(min_length=4, max_length=72)


class UserUpdate(BaseModel):
    """部分更新。指定された項目のみ反映する。"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: Role | None = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=4, max_length=72)
