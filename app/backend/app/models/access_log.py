import enum
import uuid
from datetime import datetime

from sqlalchemy import String, Enum, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Action(str, enum.Enum):
    view = "view"
    download = "download"
    print = "print"
    edit = "edit"
    delete = "delete"


class AccessLog(Base):
    """閲覧・操作ログ (F-28, F-29)。監査用に追記専用で扱う。"""

    __tablename__ = "access_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[Action] = mapped_column(Enum(Action))
    device_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    operated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
