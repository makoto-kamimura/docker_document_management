"""書類のカテゴリ (F-17, F-39)。一覧は誰でも、追加・変更・削除はテナントの管理者だけ。

カテゴリごとに公開範囲（全員 / 子供以外 / 家族 / 本人だけ）を持ち、その中の書類を見られる人の
上限になる（`deps.can_access`）。カテゴリはテナント内に閉じる。
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role, tenant_scope, visible_documents_clause
from app.db.session import get_db
from app.models.category import Category
from app.models.document import Document
from app.models.user import Role, User
from app.schemas.category import CategoryCreate, CategoryRead, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


def _to_read(db: Session, user: User, cats: list[Category]) -> list[CategoryRead]:
    """件数はその人が見られる書類だけを数える（見えない書類の存在を件数から推測させない）。"""
    counts = dict(
        db.execute(
            select(Document.category_id, func.count())
            .where(
                Document.category_id.in_([c.id for c in cats]),
                visible_documents_clause(db, user),
            )
            .group_by(Document.category_id)
        ).all()
    ) if cats else {}
    return [
        CategoryRead(
            id=c.id,
            name=c.name,
            visibility=c.visibility,
            sort_order=c.sort_order,
            icon=c.icon,
            color=c.color,
            created_at=c.created_at,
            document_count=counts.get(c.id, 0),
        )
        for c in cats
    ]


def _load(db: Session, category_id: uuid.UUID, scope: uuid.UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None or category.tenant_id != scope:
        raise HTTPException(status_code=404, detail="カテゴリが見つかりません")
    return category


def _ensure_unique(db: Session, scope: uuid.UUID, name: str) -> None:
    if db.scalar(select(Category).where(Category.tenant_id == scope, Category.name == name)):
        raise HTTPException(status_code=409, detail="同名のカテゴリが既に存在します")


@router.get("", response_model=list[CategoryRead])
def list_categories(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    scope: uuid.UUID = Depends(tenant_scope),
):
    cats = list(
        db.scalars(
            select(Category)
            .where(Category.tenant_id == scope)
            .order_by(Category.sort_order.asc(), Category.created_at.asc())
        ).all()
    )
    return _to_read(db, user, cats)


@router.post("", response_model=CategoryRead, status_code=201)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin)),
    scope: uuid.UUID = Depends(tenant_scope),
):
    name = payload.name.strip()
    _ensure_unique(db, scope, name)
    order = payload.sort_order
    if order is None:
        last = db.scalar(select(func.max(Category.sort_order)).where(Category.tenant_id == scope))
        order = 0 if last is None else last + 1
    category = Category(
        tenant_id=scope, name=name, visibility=payload.visibility, sort_order=order,
        icon=payload.icon, color=payload.color,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return _to_read(db, user, [category])[0]


@router.patch("/{category_id}", response_model=CategoryRead)
def update_category(
    category_id: uuid.UUID,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin)),
    scope: uuid.UUID = Depends(tenant_scope),
):
    """名前・公開範囲・並び順・アイコン・色を変える。

    公開範囲を変えると、中の書類を見られる人もすぐに変わる。
    """
    category = _load(db, category_id, scope)
    if payload.name is not None and payload.name.strip() != category.name:
        _ensure_unique(db, scope, payload.name.strip())
        category.name = payload.name.strip()
    if payload.visibility is not None:
        category.visibility = payload.visibility
    if payload.sort_order is not None:
        category.sort_order = payload.sort_order
    if payload.icon is not None:
        category.icon = payload.icon
    if payload.color is not None:
        category.color = payload.color
    db.commit()
    db.refresh(category)
    return _to_read(db, user, [category])[0]


@router.delete("/{category_id}", status_code=204)
def delete_category(
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(Role.admin)),
    scope: uuid.UUID = Depends(tenant_scope),
):
    """中に書類が無いカテゴリだけ削除できる。

    書類を未分類に戻すと見られる人が広がりうるため、勝手には外さない。管理者から見えない
    書類（他の人の「本人だけ」など）も数える。
    """
    category = _load(db, category_id, scope)
    count = db.scalar(
        select(func.count()).select_from(Document).where(Document.category_id == category.id)
    ) or 0
    if count:
        raise HTTPException(
            status_code=400,
            detail=f"このカテゴリには書類が{count}件あるため削除できません。"
            "書類のカテゴリを変えてから削除してください（見られない書類は登録した本人が変えます）",
        )
    db.delete(category)
    db.commit()
