import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PermissionLevel(str, enum.Enum):
    """操作範囲 (F-37)。上位は下位を包含する（delete>edit>view）。"""

    view = "view"      # 閲覧のみ
    edit = "edit"      # 編集可（閲覧含む）
    delete = "delete"  # 削除可（編集・閲覧含む）

    @property
    def rank(self) -> int:
        return {"view": 1, "edit": 2, "delete": 3}[self.value]

    def covers(self, need: "PermissionLevel") -> bool:
        return self.rank >= need.rank


class DocumentPermission(Base):
    """ドキュメント単位のアクセス権限 (F-36)。"""

    __tablename__ = "document_permissions"
    __table_args__ = (UniqueConstraint("document_id", "user_id", name="uq_doc_user"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    level: Mapped[PermissionLevel] = mapped_column(
        Enum(PermissionLevel), default=PermissionLevel.view
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
