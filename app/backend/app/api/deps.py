import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import ColumnElement, false, select, true
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models.category import Category, CategoryVisibility
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
        user_id = uuid.UUID(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        raise cred_exc
    user = db.get(User, user_id)
    if user is None:
        raise cred_exc
    if user.role != Role.super_admin and user.tenant_id is None:
        # テナント未所属（移行失敗など）は何も見せない
        raise HTTPException(status_code=403, detail="テナントに所属していません。管理者に連絡してください")
    return user


def require_role(*roles: Role):
    """ロールベースのアクセス制御 (F-35, F-37)。super_admin は常に許可（操作中のテナントの中で）。"""

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


def tenant_scope(user: User = Depends(get_current_user)) -> uuid.UUID:
    """このリクエストで扱うテナント。

    一般ユーザーは自分のテナント、super_admin は操作中のテナント（Web のテナント管理で切り替える）。
    テナントをまたぐ操作はテナント管理 (`/tenants`) にだけあり、それ以外は必ず1つのテナントの中で動く。
    """
    tenant_id = user.scope_tenant_id
    if tenant_id is None:
        raise HTTPException(
            status_code=409,
            detail="操作するテナントが選ばれていません。Web のテナント管理で選んでください",
        )
    return tenant_id


def same_tenant(user: User, tenant_id) -> bool:
    """user がそのテナントのデータを扱えるか（super_admin は操作中のテナントだけ）。"""
    return tenant_id is not None and user.scope_tenant_id == tenant_id


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


def category_visibility(db: Session, doc: Document) -> CategoryVisibility:
    """ドキュメントの公開範囲。未分類は「家族」、カテゴリが見つからなければ最も狭い「本人だけ」。"""
    if doc.category_id is None:
        return CategoryVisibility.family
    category = db.get(Category, doc.category_id)
    return category.visibility if category else CategoryVisibility.owner


def can_access(db: Session, doc: Document, user: User, need: PermissionLevel) -> bool:
    """ドキュメントに対し user が need 以上の権限を持つか (F-36, F-37)。

    最初にテナントを判定する（別テナントの書類は所有者・ACL・ロールに関わらず不可）。
    次にカテゴリの公開範囲を上限として当てはめる（管理者・全体管理者・個別共有にも適用）:
    「本人だけ」は所有者のみ、「子供以外」は子供を除く。範囲の中では、管理者と所有者は
    フル権限、それ以外は per-user ACL を参照し、閲覧(view)は「全員」「子供以外」なら誰でも、
    「家族」（未分類を含む）なら所有者と共通グループに属していれば許可（グループ自動共有）。
    """
    if not same_tenant(user, doc.tenant_id):
        return False
    if doc.owner_id == user.id:
        return True
    visibility = category_visibility(db, doc)
    if visibility == CategoryVisibility.owner:
        return False
    if visibility == CategoryVisibility.adults and user.is_child:
        return False
    if is_admin(user):
        return True
    perm = db.scalar(
        select(DocumentPermission).where(
            DocumentPermission.document_id == doc.id,
            DocumentPermission.user_id == user.id,
        )
    )
    if perm is not None and perm.level.covers(need):
        return True
    if need != PermissionLevel.view:
        return False
    if visibility in (CategoryVisibility.everyone, CategoryVisibility.adults):
        return True
    return shares_group(db, user.id, doc.owner_id)


def visible_documents_clause(db: Session, user: User) -> ColumnElement[bool]:
    """user が閲覧できるドキュメントの条件（`can_access` の view と同じ判定を SQL にしたもの）。

    一覧・検索・ログ・通知の絞り込みで使う。テナントの条件も含む。
    """
    tenant_id = user.scope_tenant_id
    if tenant_id is None:
        return false()

    def categories(*visibility: CategoryVisibility):
        return select(Category.id).where(
            Category.tenant_id == tenant_id, Category.visibility.in_(visibility)
        )

    if is_admin(user):
        family_rule: ColumnElement[bool] = true()
    else:
        granted = select(DocumentPermission.document_id).where(
            DocumentPermission.user_id == user.id
        )
        family_rule = Document.id.in_(granted) | Document.owner_id.in_(
            co_member_user_ids(db, user.id)  # 自分を含む同一グループの全員
        )
    open_to = [CategoryVisibility.everyone]
    if not user.is_child:
        open_to.append(CategoryVisibility.adults)
    return (Document.tenant_id == tenant_id) & (
        (Document.owner_id == user.id)
        | Document.category_id.in_(categories(*open_to))
        | (
            (Document.category_id.is_(None)
             | Document.category_id.in_(categories(CategoryVisibility.family)))
            & family_rule
        )
    )


def ensure_can_access(
    db: Session, doc: Document, user: User, need: PermissionLevel = PermissionLevel.view
) -> None:
    """見られない書類（別テナント・公開範囲や共有の外）は存在を伏せて 404、
    見られるが need の権限が無ければ 403 を送出する。"""
    if not can_access(db, doc, user, PermissionLevel.view):
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    if need != PermissionLevel.view and not can_access(db, doc, user, need):
        raise HTTPException(status_code=403, detail="このドキュメントへのアクセス権がありません")
