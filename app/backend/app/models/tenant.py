import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Tenant(Base):
    """テナント（利用する世帯/組織の単位）。データ分離の最上位の境界。

    users / groups / documents / notifications は必ず1つのテナントに属し、一覧・検索・
    通知のクエリはすべてテナントで絞り込む。テナントをまたいで見られるのは super_admin だけ。
    デモ用テナント (is_demo=True) を分けることで、公開しているデモ用アカウントから
    実利用の書類が見えないようにする。
    """

    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
