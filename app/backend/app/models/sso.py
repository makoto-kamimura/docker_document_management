import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UserIdentity(Base):
    """SSO（共通の認証サーバー）の連携。1 人に 1 つ、1 つの SSO のアカウントは 1 人だけ。

    利用者の特定には認証サーバーの sub だけを使う。email は表示用。
    """

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_user_identities_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_user_identities_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OAuthFlow(Base):
    """SSO の途中の状態。intent・state・結果コードはハッシュだけを持ち、使ったら消す。

    期限はタイムゾーンなしの UTC（app.services.oidc.utcnow）。
    """

    __tablename__ = "oauth_flows"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mode: Mapped[str] = mapped_column(String(8))  # login | link
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    intent_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    state_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    nonce: Mapped[str | None] = mapped_column(String(64), nullable=True)
    server_verifier: Mapped[str | None] = mapped_column(String(128), nullable=True)
    client_challenge: Mapped[str | None] = mapped_column(String(64), nullable=True)
    return_to: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    result_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
