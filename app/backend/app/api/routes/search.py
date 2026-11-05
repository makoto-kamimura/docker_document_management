import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    can_access, get_current_user, tenant_scope, visible_documents_clause,
)
from app.db.session import get_db
from app.models.document import Document
from app.models.document_permission import PermissionLevel
from app.models.user import User
from app.schemas.document import SearchHit
from app.services import categories
from app.services import search as search_service

router = APIRouter(prefix="/search", tags=["search"])


def _as_uuid(value: str) -> uuid.UUID | None:
    """索引に想定外のIDが入っていても検索を落とさない。"""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None


@router.get("", response_model=list[SearchHit])
def search_documents(
    q: str = Query(..., description="検索キーワード（タイトル/OCR本文/タグを横断）"),
    category_id: uuid.UUID | None = Query(None),
    document_type: str | None = Query(None),
    tag: str | None = Query(None, description="タグで絞り込み（完全一致）"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant: uuid.UUID = Depends(tenant_scope),
):
    """全文/絞り込み検索 (F-23〜F-26)。OCR本文に加えタイトル・タグも検索対象。

    OCR の1文字の読み違いや、ひらがなでの入力（読み）でも当たる。

    自分のテナント内で、かつ閲覧できるドキュメントだけを返す。閲覧できる範囲（カテゴリの公開範囲・
    共有・グループ）は一覧と同じ条件を DB で求め、その ID に絞って索引を検索する。返す直前にも
    DB の権限判定で確認する（索引が古い場合に権限外・別テナントのタイトル/本文が漏れないようにする）。
    カテゴリ名は索引ではなく DB から付ける（名前を変えても古い名前を返さない）。
    """
    visible = select(Document.id).where(visible_documents_clause(db, user))
    if category_id is not None:
        visible = visible.where(Document.category_id == category_id)
    doc_ids = list(db.scalars(visible).all())
    if not doc_ids:
        return []

    filters = {"document_type": document_type, "tags": tag}
    hits = search_service.search(
        q, filters=filters, access={"tenant_id": tenant, "doc_ids": doc_ids}
    )
    if not hits:
        return hits

    ids = {h["id"]: _as_uuid(h["id"]) for h in hits}
    docs = {
        d.id: d
        for d in db.scalars(
            select(Document).where(Document.id.in_([i for i in ids.values() if i]))
        ).all()
    }
    cats = categories.by_ids(db, [d.category_id for d in docs.values()])
    out = []
    for h in hits:
        doc = docs.get(ids[h["id"]])
        if doc is None or doc.tenant_id != tenant:
            continue
        if not can_access(db, doc, user, PermissionLevel.view):
            continue
        cat = cats.get(doc.category_id)
        out.append({**h, "category": cat.name if cat else None})
    return out
