"""アプリ内通知とプッシュ通知トークン。"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, tenant_clause, tenant_scope
from app.db.session import get_db
from app.models.family import Notification, PushToken
from app.models.user import User
from app.schemas.family import NotificationRead, PushTokenCreate, UnreadCount

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationRead])
def list_notifications(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    """自分宛ての通知（新しい順）。現在のテナントのものだけを返す。"""
    return db.scalars(
        select(Notification)
        .where(
            Notification.user_id == user.id,
            tenant_clause(Notification.tenant_id, scope),
        )
        .order_by(Notification.created_at.desc())
        .limit(max(1, min(limit, 200)))
    ).all()


@router.get("/notifications/unread-count", response_model=UnreadCount)
def unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    n = db.scalar(
        select(func.count()).select_from(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
            tenant_clause(Notification.tenant_id, scope),
        )
    ) or 0
    return UnreadCount(unread=n)


@router.post("/notifications/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="通知が見つかりません")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        db.commit()


@router.post("/notifications/read-all", status_code=204)
def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    db.execute(
        update(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
            tenant_clause(Notification.tenant_id, scope),
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    db.commit()


@router.post("/push-tokens", status_code=204)
def register_push_token(
    payload: PushTokenCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """端末の Expo Push Token を登録する（同じ端末で別ユーザーがログインしたら付け替える）。"""
    t = db.scalar(select(PushToken).where(PushToken.token == payload.token))
    if t is None:
        db.add(PushToken(user_id=user.id, token=payload.token, platform=payload.platform))
    else:
        t.user_id = user.id
        t.platform = payload.platform
    db.commit()


@router.delete("/push-tokens/{token}", status_code=204)
def unregister_push_token(
    token: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """ログアウト時など、この端末へのプッシュを止める。"""
    db.execute(delete(PushToken).where(PushToken.token == token, PushToken.user_id == user.id))
    db.commit()
