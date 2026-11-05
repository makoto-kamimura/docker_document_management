import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, is_super_admin, require_role, tenant_scope
from app.core.security import hash_password
from app.db.session import get_db
from app.models.tenant import Tenant
from app.models.user import User, Role
from app.schemas.user import UserRead, UserCreate, UserUpdate, PasswordReset

# ユーザー・権限のマスタ管理 (F-35, F-38)。全エンドポイント管理者限定。
# 扱えるのは操作中のテナントのユーザーだけ（super_admin も同じ）。テナント間の移動は
# テナント管理 (`/tenants/{id}/users/{user_id}`) で行う。
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


def _load(db: Session, user_id: uuid.UUID, scope: uuid.UUID) -> User:
    """スコープ内のユーザーを取得する（別テナントは存在を伏せて 404）。"""
    user = db.get(User, user_id)
    if user is None or user.tenant_id != scope:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    return user


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db), scope: uuid.UUID = Depends(tenant_scope)):
    """ユーザー一覧。操作中のテナントのユーザーだけを返す。"""
    rows = list(
        db.scalars(
            select(User)
            .where(User.tenant_id == scope)
            .order_by(User.created_at.asc())
        ).all()
    )
    return _decorate(db, rows)


@router.post("", response_model=UserRead, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    scope: uuid.UUID = Depends(tenant_scope),
):
    """操作中のテナントにユーザーを作る。"""
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="このメールアドレスは既に使用されています")
    if payload.role == Role.super_admin and not is_super_admin(current):
        raise HTTPException(status_code=403, detail="全体管理者を作成できるのは全体管理者のみです")

    is_super = payload.role == Role.super_admin
    user = User(
        email=payload.email,
        name=payload.name,
        role=payload.role,
        # 全体管理者はテナントに属さず、作成したテナントを操作中にする
        tenant_id=None if is_super else scope,
        active_tenant_id=scope if is_super else None,
        is_child=payload.is_child and not is_super,
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
    scope: uuid.UUID = Depends(tenant_scope),
):
    return _decorate(db, [_load(db, user_id, scope)])[0]


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    scope: uuid.UUID = Depends(tenant_scope),
):
    user = _load(db, user_id, scope)

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
    if payload.is_child is not None:
        user.is_child = payload.is_child

    db.commit()
    db.refresh(user)
    return _decorate(db, [user])[0]


@router.post("/{user_id}/password", status_code=204)
def reset_password(
    user_id: uuid.UUID,
    payload: PasswordReset,
    db: Session = Depends(get_db),
    scope: uuid.UUID = Depends(tenant_scope),
):
    user = _load(db, user_id, scope)
    user.hashed_password = hash_password(payload.password)
    db.commit()


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    scope: uuid.UUID = Depends(tenant_scope),
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
