import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.family import ActionStatus, NotificationKind


class InsightRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    importance: str
    deadline: date | None = None
    event_date: date | None = None
    audience: str | None = None
    keywords: list[str] = []
    reasons: list[str] = []
    manual: bool = False


class InsightUpdate(BaseModel):
    """解析結果の手動修正。指定したフィールドのみ更新し、以後は自動解析で上書きしない。"""

    importance: Literal["high", "normal", "low"] | None = None
    deadline: date | None = None
    event_date: date | None = None
    audience: str | None = Field(default=None, max_length=100)
    keywords: list[str] | None = None


class FamilyMemberStatus(BaseModel):
    user_id: uuid.UUID
    name: str
    is_owner: bool
    read_at: datetime | None = None
    action: ActionStatus | None = None
    action_at: datetime | None = None
    confirmed: bool


class FamilyStatus(BaseModel):
    insight: InsightRead | None = None
    members: list[FamilyMemberStatus]
    all_confirmed: bool


class ActionUpdate(BaseModel):
    status: ActionStatus


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class CommentRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    body: str
    created_at: datetime


class NotifyRequest(BaseModel):
    user_id: uuid.UUID | None = None  # 未指定なら未確認の家族全員


class NotifyResult(BaseModel):
    sent: int


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID | None = None
    kind: NotificationKind
    title: str
    body: str
    read_at: datetime | None = None
    created_at: datetime


class UnreadCount(BaseModel):
    unread: int


class PushTokenCreate(BaseModel):
    token: str = Field(min_length=10, max_length=255)
    platform: str | None = Field(default=None, max_length=20)
