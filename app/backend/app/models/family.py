"""家族で紙の情報を共有・通知するためのモデル。

撮影 → OCR → 文書解析(重要度/期限) → 通知 → 家族で確認 → 対応状況の共有 を支える。
家族の単位は既存のグループ（所属メンバー間でドキュメントを自動共有）を使う。
既存テーブルを変更しないよう、すべて別テーブルで持つ（create_all で追加作成される）。
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DocumentInsight(Base):
    """文書解析の結果（1ドキュメント1件）。manual=True は利用者が修正済みで自動解析で上書きしない。"""

    __tablename__ = "document_insights"

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    importance: Mapped[str] = mapped_column(String(10), default="normal")  # high / normal / low
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    audience: Mapped[str | None] = mapped_column(String(100), nullable=True)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    manual: Mapped[bool] = mapped_column(Boolean, default=False)
    # 家族への初回通知を送ったか（取込直後に1回だけ送るため）
    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ActionStatus(str, enum.Enum):
    seen = "seen"          # 確認した
    will_do = "will_do"    # 対応する
    done = "done"          # 対応済み
    later = "later"        # あとで確認


class DocumentAction(Base):
    """家族それぞれの対応状況（誰が何をしたか）。"""

    __tablename__ = "document_actions"
    __table_args__ = (UniqueConstraint("document_id", "user_id", name="uq_action_doc_user"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[ActionStatus] = mapped_column(Enum(ActionStatus))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DocumentComment(Base):
    """家族間のコメント。"""

    __tablename__ = "document_comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NotificationKind(str, enum.Enum):
    new_document = "new_document"  # 新しい紙が届いた
    reminder = "reminder"          # 未確認のリマインド
    renotify = "renotify"          # 家族からの「もう一度通知」
    deadline = "deadline"          # 期限が近い
    comment = "comment"            # コメントが付いた


class Notification(Base):
    """アプリ内通知（受信者ごと）。プッシュ送信の記録も兼ねる。"""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # 通知もテナントで絞り込む（受信者が別テナントへ移っても過去の通知は持ち越さない）
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id"), index=True, nullable=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=True
    )
    kind: Mapped[NotificationKind] = mapped_column(Enum(NotificationKind))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(500), default="")
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class PushToken(Base):
    """端末のプッシュ通知トークン（Expo Push Token）。"""

    __tablename__ = "push_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
