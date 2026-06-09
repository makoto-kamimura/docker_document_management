import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DocumentVersion(Base):
    """ドキュメントのバージョン履歴 (F-19)。

    差し替え(再アップロード)時に、差し替え前の成果物キー/ページ数/OCRテキストを
    スナップショットとして退避する。原本はストレージに残したまま履歴を保持する。
    """

    __tablename__ = "document_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    file_format: Mapped[str] = mapped_column(String(20), default="pdf")
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
