import enum
import uuid
from datetime import datetime, date

from sqlalchemy import String, Integer, Text, Enum, DateTime, Date, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class StorageLocation(str, enum.Enum):
    cloud = "cloud"      # 非機密 → クラウド
    onprem = "onprem"    # 機密   → オンプレミス


class Sensitivity(str, enum.Enum):
    public = "public"
    internal = "internal"
    confidential = "confidential"


class OcrStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    failed = "failed"


class Document(Base):
    """ドキュメント (F-12, F-17〜F-20)。"""

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # 所属テナント。一覧・検索・通知はすべてこの条件で絞り込む
    # （既存DBからの移行中のみ NULL になり得る。起動時の移行で必ず埋める）
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), index=True)
    category: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    document_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    file_format: Mapped[str] = mapped_column(String(20), default="pdf")
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_status: Mapped[OcrStatus] = mapped_column(Enum(OcrStatus), default=OcrStatus.pending)

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    sensitivity: Mapped[Sensitivity] = mapped_column(Enum(Sensitivity), default=Sensitivity.internal)
    storage_location: Mapped[StorageLocation] = mapped_column(Enum(StorageLocation), default=StorageLocation.cloud)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    version: Mapped[int] = mapped_column(Integer, default=1)
    retention_until: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
