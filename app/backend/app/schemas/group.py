import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import Role


class GroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    member_count: int = 0


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None


class GroupMemberRead(BaseModel):
    """グループ所属ユーザーの表示用。"""

    user_id: uuid.UUID
    name: str
    email: str
    role: Role
