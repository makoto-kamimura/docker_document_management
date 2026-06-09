from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.document import SearchHit
from app.services import search as search_service

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=list[SearchHit])
def search_documents(
    q: str = Query(..., description="検索キーワード（タイトル/OCR本文/要約/タグを横断）"),
    category: str | None = Query(None),
    document_type: str | None = Query(None),
    tag: str | None = Query(None, description="タグで絞り込み（完全一致）"),
    user: User = Depends(get_current_user),
):
    """全文/絞り込み検索 (F-23〜F-26)。OCR本文に加え要約・タグも検索対象。"""
    filters = {"category": category, "document_type": document_type, "tags": tag}
    return search_service.search(q, filters=filters)
