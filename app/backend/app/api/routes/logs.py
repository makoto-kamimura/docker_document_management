import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.access_log import AccessLog
from app.models.user import Role, User

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("")
def list_logs(
    document_id: uuid.UUID | None = Query(None),
    user_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
):
    """閲覧履歴照会 (F-30)。管理者のみ。"""
    stmt = select(AccessLog).order_by(AccessLog.operated_at.desc())
    if document_id:
        stmt = stmt.where(AccessLog.document_id == document_id)
    if user_id:
        stmt = stmt.where(AccessLog.user_id == user_id)
    return db.scalars(stmt.limit(500)).all()
