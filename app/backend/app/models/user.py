import enum
import uuid
from datetime import datetime

from sqlalchemy import String, Enum, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Role(str, enum.Enum):
    super_admin = "super_admin"  # 全体管理者（テナント横断。テナントには所属しない）
    admin = "admin"              # テナント管理者（自テナント内のみ）
    registrar = "registrar"      # 登録者
    viewer = "viewer"            # 閲覧者


# テナント内の管理操作（ユーザー/グループ管理・ログ閲覧）を行えるロール
ADMIN_ROLES = (Role.super_admin, Role.admin)


class User(Base):
    """ユーザー (F-33, F-35)。super_admin 以外は必ずテナントに属する。"""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # メールアドレスはログインIDのためテナントをまたいで一意
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.viewer)
    hashed_password: Mapped[str] = mapped_column(String(255))
    # super_admin のみ NULL（全テナントを扱うため所属を持たない）
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id"), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
