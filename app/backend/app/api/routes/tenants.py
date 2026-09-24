"""テナント（データ分離の単位）のマスタ管理。

一覧はロールで見える範囲が変わる:
- super_admin: すべてのテナント（作成・更新・削除も可能）
- それ以外   : 自分が所属するテナントのみ（表示用）
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, is_super_admin
from app.db.session import get_db
from app.models.document import Document
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import TenantCreate, TenantRead, TenantUpdate

router = APIRouter(prefix="/tenants", tags=["tenants"])


def _require_super(user: User) -> None:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="テナントの管理は全体管理者のみ可能です")


def _counts(db: Session, tenant_ids: list) -> tuple[dict, dict]:
    if not tenant_ids:
        return {}, {}
    users = dict(
        db.execute(
            select(User.tenant_id, func.count())
            .where(User.tenant_id.in_(tenant_ids))
            .group_by(User.tenant_id)
        ).all()
    )
    docs = dict(
        db.execute(
            select(Document.tenant_id, func.count())
            .where(Document.tenant_id.in_(tenant_ids))
            .group_by(Document.tenant_id)
        ).all()
    )
    return users, docs


def _to_read(db: Session, tenants: list[Tenant]) -> list[TenantRead]:
    users, docs = _counts(db, [t.id for t in tenants])
    return [
        TenantRead(
            id=t.id,
            slug=t.slug,
            name=t.name,
            description=t.description,
            is_demo=t.is_demo,
            created_at=t.created_at,
            user_count=users.get(t.id, 0),
            document_count=docs.get(t.id, 0),
        )
        for t in tenants
    ]


@router.get("", response_model=list[TenantRead])
def list_tenants(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = select(Tenant).order_by(Tenant.created_at.asc())
    if not is_super_admin(user):
        stmt = stmt.where(Tenant.id == user.tenant_id)
    return _to_read(db, list(db.scalars(stmt).all()))


@router.post("", response_model=TenantRead, status_code=201)
def create_tenant(
    payload: TenantCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_super(user)
    if db.scalar(select(Tenant).where(Tenant.slug == payload.slug)):
        raise HTTPException(status_code=409, detail="この識別子のテナントは既に存在します")
    tenant = Tenant(**payload.model_dump())
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return _to_read(db, [tenant])[0]


@router.patch("/{tenant_id}", response_model=TenantRead)
def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_super(user)
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="テナントが見つかりません")
    for k, v in payload.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(tenant, k, v)
    db.commit()
    db.refresh(tenant)
    return _to_read(db, [tenant])[0]


@router.delete("/{tenant_id}", status_code=204)
def delete_tenant(
    tenant_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """空のテナントのみ削除できる（誤操作でデータごと消さないため）。"""
    _require_super(user)
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="テナントが見つかりません")
    users, docs = _counts(db, [tenant_id])
    if users.get(tenant_id, 0) or docs.get(tenant_id, 0):
        raise HTTPException(
            status_code=400,
            detail="ユーザーまたはドキュメントが残っているテナントは削除できません",
        )
    db.delete(tenant)
    db.commit()
