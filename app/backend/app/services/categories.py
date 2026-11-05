"""書類のカテゴリ（公開範囲つき）の共通処理。"""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.category import DEFAULT_CATEGORIES, Category


def create_defaults(db: Session, tenant_id: uuid.UUID) -> None:
    """サンプルのカテゴリ（投函チラシ・重要書類・処方箋）を用意する。同名があれば作らない。"""
    existing = set(db.scalars(select(Category.name).where(Category.tenant_id == tenant_id)).all())
    for order, (name, visibility) in enumerate(DEFAULT_CATEGORIES):
        if name not in existing:
            db.add(Category(
                tenant_id=tenant_id, name=name, visibility=visibility, sort_order=order
            ))
    db.commit()


def load_in_tenant(db: Session, category_id: uuid.UUID | None, tenant_id) -> Category | None:
    """書類に付けるカテゴリを取得する。別テナントや存在しないカテゴリは 400。"""
    if category_id is None:
        return None
    category = db.get(Category, category_id)
    if category is None or category.tenant_id != tenant_id:
        raise HTTPException(status_code=400, detail="カテゴリが見つかりません")
    return category


def by_ids(db: Session, ids) -> dict:
    """{category_id: Category}（一覧の N+1 回避）。"""
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {c.id: c for c in db.scalars(select(Category).where(Category.id.in_(ids))).all()}
