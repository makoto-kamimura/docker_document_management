import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    can_access, co_member_user_ids, get_current_user, is_admin, tenant_scope,
)
from app.db.session import get_db
from app.models.document import Document
from app.models.document_permission import DocumentPermission, PermissionLevel
from app.models.user import User
from app.schemas.document import SearchHit
from app.services import search as search_service

router = APIRouter(prefix="/search", tags=["search"])


def _access_scope(db: Session, user: User, tenant_id: uuid.UUID | None) -> dict | None:
    """検索できる範囲。全体管理者が全テナントを見る場合のみ None（無条件）。

    それ以外は必ずテナントで絞り、テナント管理者はテナント内全件、一般ユーザーは
    所有 / 同一グループの家族が所有 / 個別に共有された のドキュメントに限る
    （一覧 `GET /documents` と同じ条件）。
    """
    if tenant_id is None:
        return None
    scope: dict = {"tenant_id": tenant_id}
    if is_admin(user):
        return scope
    owner_ids = set(co_member_user_ids(db, user.id)) | {user.id}
    doc_ids = db.scalars(
        select(DocumentPermission.document_id).where(DocumentPermission.user_id == user.id)
    ).all()
    scope["owner_ids"] = list(owner_ids)
    scope["doc_ids"] = list(doc_ids)
    return scope


def _as_uuid(value: str) -> uuid.UUID | None:
    """索引に想定外のIDが入っていても検索を落とさない。"""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None


@router.get("", response_model=list[SearchHit])
def search_documents(
    q: str = Query(..., description="検索キーワード（タイトル/OCR本文/要約/タグを横断）"),
    category: str | None = Query(None),
    document_type: str | None = Query(None),
    tag: str | None = Query(None, description="タグで絞り込み（完全一致）"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant: uuid.UUID | None = Depends(tenant_scope),
):
    """全文/絞り込み検索 (F-23〜F-26)。OCR本文に加え要約・タグも検索対象。

    自分のテナント内で、かつ閲覧権限のあるドキュメントだけを返す。検索索引側で絞り込んだうえで、
    返す直前に DB の権限判定でも確認する（索引が古い場合に権限外・別テナントのタイトル/本文が
    漏れないようにする）。
    """
    filters = {"category": category, "document_type": document_type, "tags": tag}
    scope = _access_scope(db, user, tenant)
    hits = search_service.search(q, filters=filters, access=scope)
    if scope is None or not hits:
        return hits

    ids = {h["id"]: _as_uuid(h["id"]) for h in hits}
    docs = {
        d.id: d
        for d in db.scalars(
            select(Document).where(Document.id.in_([i for i in ids.values() if i]))
        ).all()
    }
    return [
        h
        for h in hits
        if (doc := docs.get(ids[h["id"]])) is not None
        and doc.tenant_id == tenant
        and can_access(db, doc, user, PermissionLevel.view)
    ]
