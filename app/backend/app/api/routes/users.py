import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user, is_super_admin, require_role, tenant_clause, tenant_scope,
)
from app.core.security import hash_password
from app.db.session import get_db
from app.models.tenant import Tenant
from app.models.user import User, Role
from app.schemas.user import UserRead, UserCreate, UserUpdate, PasswordReset
from app.services import tenants as tenant_service

# ユーザー・権限のマスタ管理 (F-35, F-38)。全エンドポイント管理者限定。
# テナント管理者(admin)は自テナントのユーザーだけを扱える。super_admin は全テナント。
router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(require_role(Role.admin))],
)


def _admin_count(db: Session, tenant_id) -> int:
    """テナント内の管理者数（最後の管理者を守るガードに使う）。"""
    return db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == Role.admin, User.tenant_id == tenant_id)
    ) or 0


def _decorate(db: Session, users: list[User]) -> list[User]:
    """表示用にテナント名を付与する（pydantic from_attributes が読む）。"""
    ids = {u.tenant_id for u in users if u.tenant_id}
    names = {
        t.id: t.name for t in db.scalars(select(Tenant).where(Tenant.id.in_(ids))).all()
    } if ids else {}
    for u in users:
        u.tenant_name = names.get(u.tenant_id)
    return users


def _load(db: Session, user_id: uuid.UUID, scope: uuid.UUID | None) -> User:
    """スコープ内のユーザーを取得する（別テナントは存在を伏せて 404）。"""
    user = db.get(User, user_id)
    if user is None or (scope is not None and user.tenant_id != scope):
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    return user


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db), scope: uuid.UUID | None = Depends(tenant_scope)):
    """ユーザー一覧。テナント管理者には自テナントのユーザーだけを返す。"""
    rows = list(
        db.scalars(
            select(User)
            .where(tenant_clause(User.tenant_id, scope))
            .order_by(User.created_at.asc())
        ).all()
    )
    return _decorate(db, rows)


@router.post("", response_model=UserRead, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="このメールアドレスは既に使用されています")
    if payload.role == Role.super_admin and not is_super_admin(current):
        raise HTTPException(status_code=403, detail="全体管理者を作成できるのは全体管理者のみです")

    if payload.role == Role.super_admin:
        tenant_id = None  # 全体管理者はテナントに属さない
    elif is_super_admin(current):
        tenant_id = payload.tenant_id or scope
        if tenant_id is None:
            raise HTTPException(status_code=400, detail="所属テナントを指定してください")
        if db.get(Tenant, tenant_id) is None:
            raise HTTPException(status_code=404, detail="テナントが見つかりません")
    else:
        tenant_id = current.tenant_id  # テナント管理者は自テナント固定

    user = User(
        email=payload.email,
        name=payload.name,
        role=payload.role,
        tenant_id=tenant_id,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _decorate(db, [user])[0]


@router.get("/{user_id}", response_model=UserRead)
def get_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    return _decorate(db, [_load(db, user_id, scope)])[0]


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    user = _load(db, user_id, scope)
    data = payload.model_dump(exclude_unset=True)

    if "tenant_id" in data and data["tenant_id"] != user.tenant_id:
        # テナントの移動は全体管理者のみ（所有ドキュメント・通知も一緒に移る）
        if not is_super_admin(current):
            raise HTTPException(status_code=403, detail="テナントの変更は全体管理者のみ可能です")
        if user.role == Role.super_admin:
            raise HTTPException(status_code=400, detail="全体管理者はテナントに所属しません")
        target = data["tenant_id"]
        if target is None or db.get(Tenant, target) is None:
            raise HTTPException(status_code=404, detail="テナントが見つかりません")
        tenant_service.move_user(db, user, target)

    if payload.role is not None and payload.role != user.role:
        if user.id == current.id:
            raise HTTPException(status_code=400, detail="自分自身のロールは変更できません")
        if payload.role == Role.super_admin or user.role == Role.super_admin:
            raise HTTPException(
                status_code=403 if not is_super_admin(current) else 400,
                detail="全体管理者ロールの付与・解除は API からは行えません",
            )
        if user.role == Role.admin and _admin_count(db, user.tenant_id) <= 1:
            raise HTTPException(status_code=400, detail="テナント最後の管理者のロールは変更できません")
        user.role = payload.role

    if payload.name is not None:
        user.name = payload.name

    db.commit()
    db.refresh(user)
    return _decorate(db, [user])[0]


@router.post("/{user_id}/password", status_code=204)
def reset_password(
    user_id: uuid.UUID,
    payload: PasswordReset,
    db: Session = Depends(get_db),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    user = _load(db, user_id, scope)
    user.hashed_password = hash_password(payload.password)
    db.commit()


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    user = _load(db, user_id, scope)
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="自分自身は削除できません")
    if user.role == Role.super_admin:
        raise HTTPException(status_code=400, detail="全体管理者は API からは削除できません")
    if user.role == Role.admin and _admin_count(db, user.tenant_id) <= 1:
        raise HTTPException(status_code=400, detail="テナント最後の管理者は削除できません")
    db.delete(user)
    db.commit()
