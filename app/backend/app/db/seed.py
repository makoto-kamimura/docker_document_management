"""テーブル作成・テナント移行・初期ユーザー投入（マイグレーション基盤導入までの暫定措置）。

テナント分離の導入にあたり、バックエンド起動時に次を行う:

1. テーブル作成 (`create_all`) と既存テーブルへの `tenant_id` 追加 (`migrate`)
2. 実利用テナント / デモテナントの作成
3. テナント導入前のデータを `SEED_LEGACY_TENANT_SLUG` のテナントへ割り当て
4. 初期ユーザーの投入（認証情報は環境変数で上書き可能）
   - 全体管理者: **非公開**。テナントに属さず全テナントを管理する
   - 実利用テナント: 管理者1人
   - デモテナント: 公開する 管理者 / 登録者 / 閲覧者 の3アカウント + デモ用グループ
"""

import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db import migrate
from app.db.session import Base, engine, SessionLocal
from app.models.group import Group, GroupMember
from app.models.tenant import Tenant
from app.models.user import User, Role


def ensure_tenant(db: Session, slug: str, name: str, is_demo: bool) -> Tenant:
    tenant = db.scalar(select(Tenant).where(Tenant.slug == slug))
    if tenant is None:
        tenant = Tenant(slug=slug, name=name, is_demo=is_demo)
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        print(f"[init] tenant created: {slug} ({name})")
    return tenant


def ensure_user(
    db: Session, email: str, name: str, role: Role, password: str, tenant_id
) -> User | None:
    """未登録なら作成して返す。password が空なら自動生成してログへ1度だけ出力する。"""
    if not email:
        return None
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        return existing
    generated = not password
    if generated:
        password = secrets.token_urlsafe(12)
    user = User(
        email=email,
        name=name,
        role=role,
        tenant_id=tenant_id,
        hashed_password=hash_password(password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    if generated:
        print(f"[init] {role.value} created: {email} / {password}  ← 初回のみ表示。控えて変更すること")
    else:
        print(f"[init] {role.value} created: {email}")
    return user


def seed_demo_accounts(db: Session, tenant_id) -> None:
    """デモテナントの公開アカウント（管理者/登録者/閲覧者）とグループを用意する。

    ロールごとの見え方を試せるよう3つ作り、同じグループへ入れる（グループ自動共有 F-36 で
    管理者が登録した書類を登録者・閲覧者も見られる状態にする）。
    """
    members = []
    for email, name, role in (
        (settings.seed_demo_admin_email, "デモ管理者", Role.admin),
        (settings.seed_demo_registrar_email, "デモ登録者", Role.registrar),
        (settings.seed_demo_viewer_email, "デモ閲覧者", Role.viewer),
    ):
        user = ensure_user(db, email, name, role, settings.seed_demo_password, tenant_id)
        if user is not None:
            members.append(user)
    if not members or not settings.seed_demo_group_name:
        return

    group = db.scalar(
        select(Group).where(
            Group.tenant_id == tenant_id, Group.name == settings.seed_demo_group_name
        )
    )
    if group is None:
        group = Group(tenant_id=tenant_id, name=settings.seed_demo_group_name,
                      description="デモ用。ロールごとの見え方を試せます")
        db.add(group)
        db.commit()
        db.refresh(group)
    for user in members:
        exists = db.scalar(
            select(GroupMember).where(
                GroupMember.group_id == group.id, GroupMember.user_id == user.id
            )
        )
        if exists is None:
            db.add(GroupMember(group_id=group.id, user_id=user.id))
    db.commit()


def init_db() -> None:
    """起動時の初期化（冪等）。"""
    Base.metadata.create_all(bind=engine)
    migrate.add_tenant_columns()

    with SessionLocal() as db:
        primary = ensure_tenant(
            db, settings.tenant_primary_slug, settings.tenant_primary_name, is_demo=False
        )
        demo = ensure_tenant(
            db, settings.tenant_demo_slug, settings.tenant_demo_name, is_demo=True
        )
        # テナント導入前のデータの引き取り先（既定は実利用テナント）
        legacy = demo if settings.seed_legacy_tenant_slug == demo.slug else primary
        migrate.backfill(db, legacy.id)

        # 全体管理者（テナントに属さず、すべてのテナントを管理できる**非公開**アカウント）
        ensure_user(
            db, settings.seed_super_admin_email, "全体管理者", Role.super_admin,
            settings.seed_super_admin_password, None,
        )
        # 実利用テナントの管理者
        ensure_user(
            db, settings.seed_admin_email, "管理者", Role.admin,
            settings.seed_admin_password, primary.id,
        )
        # デモテナントの公開アカウント（管理者/登録者/閲覧者）とデモ用グループ
        seed_demo_accounts(db, demo.id)

    migrate.finalize()
