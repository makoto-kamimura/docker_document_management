import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CategoryVisibility(str, enum.Enum):
    """カテゴリの公開範囲。その中の書類を見られる人の上限（管理者・全体管理者にも適用する）。"""

    everyone = "everyone"  # テナントの全員
    adults = "adults"      # 子供を除く全員（登録者本人は子供でも見られる）
    family = "family"      # 従来どおり: 登録者・同じグループ・個別共有・管理者（未分類の書類も同じ）
    owner = "owner"        # 登録者本人だけ


class Category(Base):
    """書類のカテゴリ (F-17, F-39)。テナントの管理者が追加し、公開範囲を決める。

    カテゴリはテナント内に閉じる。同名のカテゴリはテナントが違えば作成できる。
    """

    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_category_tenant_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    visibility: Mapped[CategoryVisibility] = mapped_column(
        Enum(CategoryVisibility), default=CategoryVisibility.family
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# 新しいテナントに用意するサンプル（名前, 公開範囲）
DEFAULT_CATEGORIES: tuple[tuple[str, CategoryVisibility], ...] = (
    ("投函チラシ", CategoryVisibility.everyone),
    ("重要書類", CategoryVisibility.adults),
    ("処方箋", CategoryVisibility.owner),
)
