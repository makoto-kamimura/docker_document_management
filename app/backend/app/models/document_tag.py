import uuid

from sqlalchemy import String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DocumentTag(Base):
    """ドキュメントのタグ (F-17)。

    既存 documents テーブルを ALTER せずタグを表現するための別テーブル。
    1ドキュメント=複数タグ。(document_id, tag) で一意。
    """

    __tablename__ = "document_tags"
    __table_args__ = (UniqueConstraint("document_id", "tag", name="uq_doc_tag"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id"), index=True
    )
    tag: Mapped[str] = mapped_column(String(100), index=True)
