import uuid

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import ColumnElement, select, true
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models.document import Document
from app.models.document_permission import DocumentPermission, PermissionLevel
from app.models.group import GroupMember
from app.models.user import ADMIN_ROLES, User, Role

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
    if user.role != Role.super_admin and user.tenant_id is None:
        # テナント未所属（移行失敗など）は何も見せない
        raise HTTPException(status_code=403, detail="テナントに所属していません。管理者に連絡してください")
    return user


def require_role(*roles: Role):
    """ロールベースのアクセス制御 (F-35, F-37)。super_admin は常に許可。"""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role != Role.super_admin and user.role not in roles:
            raise HTTPException(status_code=403, detail="権限がありません")
        return user

    return checker


# ---- テナント (データ分離) ----


def is_super_admin(user: User) -> bool:
    return user.role == Role.super_admin


def is_admin(user: User) -> bool:
    """テナント内の管理操作ができるか（テナント管理者 or 全体管理者）。"""
    return user.role in ADMIN_ROLES


def tenant_scope(
    user: User = Depends(get_current_user),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> uuid.UUID | None:
    """このリクエストで扱うテナント。`None` は全テナント（super_admin のみ）。

    一般ユーザーは常に自分のテナントに固定される。super_admin だけが `X-Tenant-Id`
    ヘッダで対象テナントを切り替えられ、未指定なら全テナント横断になる。
    """
    if not is_super_admin(user):
        return user.tenant_id
    if x_tenant_id:
        try:
            return uuid.UUID(x_tenant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="X-Tenant-Id が不正です")
    return None


def require_tenant(scope: uuid.UUID | None = Depends(tenant_scope)) -> uuid.UUID:
    """テナントを特定できないと実行できない操作（作成系）で使う。"""
    if scope is None:
        raise HTTPException(
            status_code=400, detail="対象テナントを指定してください（X-Tenant-Id）"
        )
    return scope


def tenant_clause(column, scope: uuid.UUID | None) -> ColumnElement[bool]:
    """一覧・検索クエリへ付けるテナント条件。scope が None（全体管理者）なら無条件。"""
    return true() if scope is None else column == scope


def in_scope(scope: uuid.UUID | None, tenant_id) -> bool:
    return scope is None or tenant_id == scope


def ensure_in_scope(scope: uuid.UUID | None, tenant_id, detail: str = "別のテナントのデータです") -> None:
    if not in_scope(scope, tenant_id):
        raise HTTPException(status_code=404, detail=detail)


def same_tenant(user: User, tenant_id) -> bool:
    """user がそのテナントのデータを扱えるか（super_admin は全テナント可）。"""
    return is_super_admin(user) or user.tenant_id == tenant_id


# ---- グループ・ドキュメントのアクセス判定 ----


def co_member_user_ids(db: Session, user_id) -> list:
    """user_id と共通グループに属する全ユーザーID（自分を含む）。

    グループ自動共有 (F-36) の判定・一覧フィルタで使う。グループはテナント内に閉じているため、
    ここで得られるのは同一テナントのユーザーだけ。
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

    最初にテナントを判定する（別テナントの書類は所有者・ACL・ロールに関わらず不可）。
    同一テナント内では、テナント管理者と所有者は常にフル権限。それ以外は per-user ACL を
    参照し、閲覧(view)については所有者と共通グループに属していれば許可（グループ自動共有）。
    """
    if is_super_admin(user):
        return True
    if doc.tenant_id != user.tenant_id:
        return False
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
    """権限が無ければ 403（別テナントなら存在を伏せて 404）を送出する。"""
    if not same_tenant(user, doc.tenant_id):
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    if not can_access(db, doc, user, need):
        raise HTTPException(status_code=403, detail="このドキュメントへのアクセス権がありません")
