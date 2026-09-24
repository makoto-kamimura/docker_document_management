"""家族での確認・対応・コメント・再通知（撮影した紙を家族で見逃さないための API）。

いずれもドキュメントの閲覧権限（所有者・同じグループの家族・個別共有先・管理者）が必要。
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_access, get_current_user
from app.db.session import get_db
from app.models.access_log import AccessLog, Action
from app.models.document import Document
from app.models.document_permission import PermissionLevel
from app.models.family import DocumentAction, DocumentComment, DocumentInsight
from app.models.read_receipt import DocumentReadReceipt
from app.models.user import User
from app.schemas.family import (
    ActionUpdate, CommentCreate, CommentRead, FamilyMemberStatus, FamilyStatus, InsightRead,
    InsightUpdate, NotifyRequest, NotifyResult,
)
from app.services import family

router = APIRouter(prefix="/documents", tags=["family"])


def _load(db: Session, doc_id: uuid.UUID, user: User, need=PermissionLevel.view) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, need)
    return doc


def _family_status(db: Session, doc: Document) -> FamilyStatus:
    ins = db.get(DocumentInsight, doc.id)
    members = [FamilyMemberStatus(**m) for m in family.member_statuses(db, doc)]
    return FamilyStatus(
        insight=InsightRead.model_validate(ins) if ins else None,
        members=members,
        all_confirmed=all(m.confirmed for m in members),
    )


@router.get("/{doc_id}/family", response_model=FamilyStatus)
def get_family_status(
    doc_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """解析結果（重要度・期限・対象）と、家族それぞれの既読・対応状況。"""
    return _family_status(db, _load(db, doc_id, user))


@router.put("/{doc_id}/insight", response_model=FamilyStatus)
def update_insight(
    doc_id: uuid.UUID,
    payload: InsightUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """解析結果の手動修正（編集権限が必要）。修正後は自動解析で上書きしない。"""
    doc = _load(db, doc_id, user, PermissionLevel.edit)
    ins = db.get(DocumentInsight, doc.id)
    if ins is None:
        # 取込前・解析前でも手動で設定できる。初回通知はワーカーの取込完了時に送る
        ins = DocumentInsight(document_id=doc.id, keywords=[], reasons=[])
        db.add(ins)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(ins, k, v if k != "keywords" else [x.strip() for x in (v or []) if x.strip()])
    ins.manual = True
    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.edit))
    db.commit()
    return _family_status(db, doc)


@router.put("/{doc_id}/action", response_model=FamilyStatus)
def set_my_action(
    doc_id: uuid.UUID,
    payload: ActionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """自分の対応状況（確認した / 対応する / 対応済み / あとで確認）を記録する。"""
    doc = _load(db, doc_id, user)
    act = db.scalar(
        select(DocumentAction).where(DocumentAction.document_id == doc.id, DocumentAction.user_id == user.id)
    )
    if act is None:
        db.add(DocumentAction(document_id=doc.id, user_id=user.id, status=payload.status))
    else:
        act.status = payload.status
    # 対応を選べるのは内容を見た人なので既読にもする
    if db.scalar(select(DocumentReadReceipt).where(
        DocumentReadReceipt.document_id == doc.id, DocumentReadReceipt.user_id == user.id
    )) is None:
        db.add(DocumentReadReceipt(document_id=doc.id, user_id=user.id))
    db.commit()
    return _family_status(db, doc)


@router.post("/{doc_id}/notify", response_model=NotifyResult)
def notify_family(
    doc_id: uuid.UUID,
    payload: NotifyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """家族にもう一度知らせる。user_id 指定でその人だけ、未指定なら未確認の全員へ。"""
    doc = _load(db, doc_id, user)
    if payload.user_id is not None:
        members = family.family_ids_map(db, [doc])[doc.id]
        if payload.user_id not in members:
            raise HTTPException(status_code=400, detail="この書類を共有している家族ではありません")
    return NotifyResult(sent=family.renotify(db, doc, user, payload.user_id))


@router.get("/{doc_id}/comments", response_model=list[CommentRead])
def list_comments(
    doc_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    doc = _load(db, doc_id, user)
    rows = db.execute(
        select(DocumentComment, User)
        .join(User, User.id == DocumentComment.user_id)
        .where(DocumentComment.document_id == doc.id)
        .order_by(DocumentComment.created_at.asc())
    ).all()
    return [
        CommentRead(id=c.id, user_id=u.id, user_name=u.name, body=c.body, created_at=c.created_at)
        for c, u in rows
    ]


@router.post("/{doc_id}/comments", response_model=CommentRead, status_code=201)
def add_comment(
    doc_id: uuid.UUID,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """コメントを追加し、他の家族に知らせる。"""
    doc = _load(db, doc_id, user)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="コメントが空です")
    c = DocumentComment(document_id=doc.id, user_id=user.id, body=body)
    db.add(c)
    db.commit()
    db.refresh(c)
    family.notify_comment(db, doc, user, body)
    return CommentRead(id=c.id, user_id=user.id, user_name=user.name, body=c.body, created_at=c.created_at)
