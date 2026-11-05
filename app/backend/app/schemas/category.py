import uuid
from datetime import datetime

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.category import CategoryVisibility

# Ionicons の名前（-outline を除いた形）。どのアイコンを選べるかは画面側の一覧で決める
IconName = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]
# app.models.category.CATEGORY_COLORS と同じ並び
CategoryColor = Literal["slate", "indigo", "sky", "emerald", "amber", "orange", "rose", "violet"]


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    visibility: CategoryVisibility
    sort_order: int = 0
    icon: str | None = None
    color: str | None = None
    created_at: datetime
    document_count: int = 0  # その人が見られる書類の件数


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    visibility: CategoryVisibility = CategoryVisibility.family
    sort_order: int | None = None  # 未指定なら末尾
    icon: IconName | None = None
    color: CategoryColor | None = None


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    visibility: CategoryVisibility | None = None
    sort_order: int | None = None
    icon: IconName | None = None
    color: CategoryColor | None = None
