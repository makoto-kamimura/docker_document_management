import enum
import uuid
from datetime import datetime

from sqlalchemy import String, Enum, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Role(str, enum.Enum):
    admin = "admin"          # 管理者
    registrar = "registrar"  # 登録者
    viewer = "viewer"        # 閲覧者


class User(Base):
    """ユーザー (F-33, F-35)。"""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.viewer)
    hashed_password: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
