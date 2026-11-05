from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.user import MeUpdate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> dict:
    """ID/パスワード認証 (F-33)。MFA/SSO は将来拡張 (F-34)。"""
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="メールアドレスまたはパスワードが不正です")
    token = create_access_token(subject=str(user.id), role=user.role.value)
    return {"access_token": token, "token_type": "bearer"}


def _me_read(current: User, db: Session) -> UserRead:
    """全体管理者は操作中のテナントを tenant_id / tenant_name で返す（未選択なら None）。"""
    tenant_id = current.scope_tenant_id
    tenant = db.get(Tenant, tenant_id) if tenant_id else None
    return UserRead.model_validate(current).model_copy(update={
        "tenant_id": tenant.id if tenant else None,
        "tenant_name": tenant.name if tenant else None,
    })


@router.get("/me", response_model=UserRead)
def me(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """ログイン中ユーザーの情報（権限ゲート・所属テナントの表示に利用）。"""
    return _me_read(current, db)


@router.patch("/me", response_model=UserRead)
def update_me(
    payload: MeUpdate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """自分の表示名を変える。子供アカウントも含め、ログイン中の本人なら誰でも変えられる。

    家族の確認状況・コメントの名前は表示のたびに引くので、過去のコメントにも新しい名前が出る。
    """
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="名前を入力してください")
    current.name = name
    db.commit()
    db.refresh(current)
    return _me_read(current, db)
