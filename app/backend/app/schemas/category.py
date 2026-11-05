import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.category import CategoryVisibility


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    visibility: CategoryVisibility
    sort_order: int = 0
    created_at: datetime
    document_count: int = 0  # その人が見られる書類の件数


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    visibility: CategoryVisibility = CategoryVisibility.family
    sort_order: int | None = None  # 未指定なら末尾


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    visibility: CategoryVisibility | None = None
    sort_order: int | None = None
