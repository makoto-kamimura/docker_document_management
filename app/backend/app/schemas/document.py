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
    tenant_id: uuid.UUID | None = None
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
    # 文書解析（家族向け通知）の結果。解析前は importance=None
    importance: str | None = None          # high / normal / low
    deadline: date | None = None
    event_date: date | None = None
    audience: str | None = None
    keywords: list[str] = []
    my_action: str | None = None           # 自分の対応状況 seen / will_do / done / later
    family_total: int = 0                  # 家族の人数（所有者を含む）
    family_confirmed: int = 0              # そのうち確認済みの人数


class DocumentDetail(DocumentRead):
    """単体取得用。一覧では重いため OCR全文は詳細取得時のみ返す (F-16)。"""

    ocr_text: str | None = None


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
