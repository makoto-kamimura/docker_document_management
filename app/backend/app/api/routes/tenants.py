"""テナント（データ分離の単位）の管理。全エンドポイント全体管理者限定。

テナントをまたぐ操作（作成・変更・削除、操作中のテナントの切り替え、メンバーの確認とテナント間の
移動）はここにだけ置き、Web の「テナント管理」から使う。それ以外の機能は、全体管理者も操作中の
テナントの中で他のユーザーと同じように動く（`deps.tenant_scope`）。
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, is_super_admin
from app.db.session import get_db
from app.models.category import Category
from app.models.document import Document
from app.models.tenant import Tenant
from app.models.user import Role, User
from app.schemas.tenant import TenantCreate, TenantRead, TenantSwitch, TenantUpdate
from app.schemas.user import UserRead
from app.services import categories
from app.services import tenants as tenant_service


def _require_super(user: User = Depends(get_current_user)) -> User:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="テナントの管理は全体管理者のみ可能です")
    return user


router = APIRouter(prefix="/tenants", tags=["tenants"], dependencies=[Depends(_require_super)])


def _load(db: Session, tenant_id: uuid.UUID) -> Tenant:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="テナントが見つかりません")
    return tenant


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
def list_tenants(db: Session = Depends(get_db)):
    stmt = select(Tenant).order_by(Tenant.created_at.asc())
    return _to_read(db, list(db.scalars(stmt).all()))


@router.post("", response_model=TenantRead, status_code=201)
def create_tenant(payload: TenantCreate, db: Session = Depends(get_db)):
    """テナントを作り、サンプルのカテゴリ（投函チラシ・重要書類・処方箋）を用意する。"""
    if db.scalar(select(Tenant).where(Tenant.slug == payload.slug)):
        raise HTTPException(status_code=409, detail="この識別子のテナントは既に存在します")
    tenant = Tenant(**payload.model_dump())
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    categories.create_defaults(db, tenant.id)
    return _to_read(db, [tenant])[0]


@router.put("/active", response_model=TenantRead)
def switch_tenant(
    payload: TenantSwitch, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """操作中のテナントを切り替える。以後の一覧・撮影・ユーザー管理などはこのテナントの中で動く。"""
    tenant = _load(db, payload.tenant_id)
    user.active_tenant_id = tenant.id
    db.commit()
    return _to_read(db, [tenant])[0]


@router.get("/{tenant_id}/users", response_model=list[UserRead])
def list_tenant_users(tenant_id: uuid.UUID, db: Session = Depends(get_db)):
    """テナントのメンバー（確認とテナント間の移動に使う）。"""
    tenant = _load(db, tenant_id)
    users = list(
        db.scalars(
            select(User).where(User.tenant_id == tenant.id).order_by(User.created_at.asc())
        ).all()
    )
    for u in users:
        u.tenant_name = tenant.name
    return users


@router.put("/{tenant_id}/users/{user_id}", response_model=UserRead)
def move_user(tenant_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    """ユーザーをこのテナントへ移す（所有ドキュメント・通知も一緒に移り、
    テナントをまたぐグループ所属・個別共有は解除される）。"""
    tenant = _load(db, tenant_id)
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    if target.role == Role.super_admin:
        raise HTTPException(status_code=400, detail="全体管理者はテナントに所属しません")
    if target.role == Role.admin and target.tenant_id != tenant.id:
        admins = db.scalar(
            select(func.count()).select_from(User)
            .where(User.role == Role.admin, User.tenant_id == target.tenant_id)
        ) or 0
        if admins <= 1:
            raise HTTPException(status_code=400, detail="テナント最後の管理者は移動できません")
    tenant_service.move_user(db, target, tenant.id)
    db.refresh(target)
    target.tenant_name = tenant.name
    return target


@router.patch("/{tenant_id}", response_model=TenantRead)
def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdate,
    db: Session = Depends(get_db),
):
    tenant = _load(db, tenant_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(tenant, k, v)
    db.commit()
    db.refresh(tenant)
    return _to_read(db, [tenant])[0]


@router.delete("/{tenant_id}", status_code=204)
def delete_tenant(tenant_id: uuid.UUID, db: Session = Depends(get_db)):
    """空のテナントのみ削除できる（誤操作でデータごと消さないため）。

    カテゴリは一緒に消し、このテナントを操作中にしていた全体管理者は未選択に戻す。
    """
    tenant = _load(db, tenant_id)
    users, docs = _counts(db, [tenant_id])
    if users.get(tenant_id, 0) or docs.get(tenant_id, 0):
        raise HTTPException(
            status_code=400,
            detail="ユーザーまたはドキュメントが残っているテナントは削除できません",
        )
    db.execute(
        update(User).where(User.active_tenant_id == tenant.id).values(active_tenant_id=None)
    )
    db.execute(delete(Category).where(Category.tenant_id == tenant.id))
    db.delete(tenant)
    db.commit()
