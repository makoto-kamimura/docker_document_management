import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, String, Enum, DateTime, ForeignKey, false, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Role(str, enum.Enum):
    super_admin = "super_admin"  # 全体管理者（テナントの管理。テナントには所属せず、操作中のテナント内で動く）
    admin = "admin"              # テナント管理者（自テナント内のみ）
    registrar = "registrar"      # 登録者
    viewer = "viewer"            # 閲覧者


# テナント内の管理操作（ユーザー/グループ管理・ログ閲覧）を行えるロール
ADMIN_ROLES = (Role.super_admin, Role.admin)


class User(Base):
    """ユーザー (F-33, F-35)。super_admin 以外は必ずテナントに属する。

    super_admin はテナントに所属しない代わりに「操作中のテナント」(active_tenant_id) を持ち、
    テナント管理以外の操作はそのテナントの中で他のユーザーと同じように行う。
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # メールアドレスはログインIDのためテナントをまたいで一意
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.viewer)
    hashed_password: Mapped[str] = mapped_column(String(255))
    # super_admin のみ NULL（テナントに所属しない。操作するテナントは active_tenant_id）
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id"), index=True, nullable=True
    )
    # super_admin が操作中のテナント。切り替えは Web のテナント管理からだけ行う（それ以外のロールは NULL）
    active_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True
    )
    # 子供。公開範囲が「子供以外」のカテゴリの書類は見られない（ロールとは別に付ける）
    is_child: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def scope_tenant_id(self) -> uuid.UUID | None:
        """このユーザーが操作するテナント（super_admin は操作中のテナント）。"""
        return self.active_tenant_id if self.role == Role.super_admin else self.tenant_id
