from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models.document import Document
from app.models.document_permission import DocumentPermission, PermissionLevel
from app.models.group import GroupMember
from app.models.user import User, Role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="認証情報が無効です",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
    except JWTError:
        raise cred_exc
    user = db.get(User, user_id)
    if user is None:
        raise cred_exc
    return user


def require_role(*roles: Role):
    """ロールベースのアクセス制御 (F-35, F-37)。"""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="権限がありません")
        return user

    return checker


def co_member_user_ids(db: Session, user_id) -> list:
    """user_id と共通グループに属する全ユーザーID（自分を含む）。

    グループ自動共有 (F-36) の判定・一覧フィルタで使う。
    """
    my_groups = select(GroupMember.group_id).where(GroupMember.user_id == user_id)
    rows = db.scalars(
        select(GroupMember.user_id).where(GroupMember.group_id.in_(my_groups)).distinct()
    ).all()
    return list(rows)


def shares_group(db: Session, user_a_id, user_b_id) -> bool:
    """2ユーザーが共通グループに属するか。"""
    if user_a_id == user_b_id:
        return True
    my_groups = select(GroupMember.group_id).where(GroupMember.user_id == user_a_id)
    hit = db.scalar(
        select(GroupMember.id)
        .where(GroupMember.user_id == user_b_id, GroupMember.group_id.in_(my_groups))
        .limit(1)
    )
    return hit is not None


def can_access(db: Session, doc: Document, user: User, need: PermissionLevel) -> bool:
    """ドキュメントに対し user が need 以上の権限を持つか (F-36, F-37)。

    管理者と所有者は常にフル権限。それ以外は per-user ACL を参照し、
    閲覧(view)については所有者と共通グループに属していれば許可（グループ自動共有）。
    """
    if user.role == Role.admin or doc.owner_id == user.id:
        return True
    perm = db.scalar(
        select(DocumentPermission).where(
            DocumentPermission.document_id == doc.id,
            DocumentPermission.user_id == user.id,
        )
    )
    if perm is not None and perm.level.covers(need):
        return True
    if need == PermissionLevel.view and shares_group(db, user.id, doc.owner_id):
        return True
    return False


def ensure_can_access(
    db: Session, doc: Document, user: User, need: PermissionLevel = PermissionLevel.view
) -> None:
    """権限が無ければ 403 を送出する。"""
    if not can_access(db, doc, user, need):
        raise HTTPException(status_code=403, detail="このドキュメントへのアクセス権がありません")
