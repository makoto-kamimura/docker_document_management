import uuid
from datetime import datetime, date

from pydantic import BaseModel, ConfigDict

from app.models.document import StorageLocation, Sensitivity, OcrStatus


class DocumentCreate(BaseModel):
    title: str
    category: str | None = None
    document_type: str | None = None
    sensitivity: Sensitivity = Sensitivity.internal
    tags: list[str] = []
    retention_until: date | None = None


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: str | None
    document_type: str | None
    page_count: int
    file_format: str
    ocr_status: OcrStatus
    sensitivity: Sensitivity
    storage_location: StorageLocation
    owner_id: uuid.UUID
    version: int
    retention_until: date | None
    created_at: datetime
    updated_at: datetime
    is_read: bool = False  # 現在ユーザー基準の既読フラグ (F-32)。一覧/取得時に算出
    tags: list[str] = []   # メタデータのタグ (F-17)。一覧/取得時に付与


class DocumentUpdate(BaseModel):
    """メタデータ/OCRテキストの編集 (F-16/F-17)。指定フィールドのみ更新。"""

    title: str | None = None
    category: str | None = None
    document_type: str | None = None
    sensitivity: Sensitivity | None = None
    retention_until: date | None = None
    tags: list[str] | None = None
    ocr_text: str | None = None  # OCR結果の手動修正 (F-16)


class VersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    version: int
    page_count: int
    file_format: str
    note: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime


class SearchHit(BaseModel):
    id: uuid.UUID
    title: str
    snippet: str | None = None
    score: float
    category: str | None = None
    tags: list[str] = []
    matched_in: str | None = None  # ヒット箇所: ocr_text / summary / title など
