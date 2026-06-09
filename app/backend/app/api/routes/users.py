import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.security import hash_password
from app.db.session import get_db
from app.models.user import User, Role
from app.schemas.user import UserRead, UserCreate, UserUpdate, PasswordReset

# ユーザー・権限のマスタ管理 (F-35, F-38)。全エンドポイント管理者限定。
router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(require_role(Role.admin))],
)


def _admin_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == Role.admin)) or 0


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.created_at.asc())).all()


@router.post("", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="このメールアドレスは既に使用されています")
    user = User(
        email=payload.email,
        name=payload.name,
        role=payload.role,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    return user


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")

    if payload.role is not None and payload.role != user.role:
        if user.id == current.id:
            raise HTTPException(status_code=400, detail="自分自身のロールは変更できません")
        if user.role == Role.admin and _admin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="最後の管理者のロールは変更できません")
        user.role = payload.role

    if payload.name is not None:
        user.name = payload.name

    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/password", status_code=204)
def reset_password(user_id: uuid.UUID, payload: PasswordReset, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    user.hashed_password = hash_password(payload.password)
    db.commit()


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="自分自身は削除できません")
    if user.role == Role.admin and _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="最後の管理者は削除できません")
    db.delete(user)
    db.commit()
