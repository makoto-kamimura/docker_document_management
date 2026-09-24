"""テナント間でユーザーを移動する（全体管理者のみ）。

移行直後に「デモ側へ入ってしまった家族」を実利用テナントへ移す、といった整理に使う。
ユーザーだけを動かすと書類が別テナントに取り残されるため、次をまとめて移す:

- そのユーザーが所有するドキュメント（検索索引の tenant_id も更新）
- そのユーザー宛の通知
- 移動で不整合になるもの（他テナントとのグループ所属・ACL）は解除する
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.document_permission import DocumentPermission
from app.models.family import Notification
from app.models.group import Group, GroupMember
from app.models.user import User
from app.services import search


def move_user(db: Session, user: User, tenant_id: uuid.UUID) -> int:
    """user を tenant_id へ移し、所有ドキュメント数を返す。"""
    if user.tenant_id == tenant_id:
        return 0

    doc_ids = list(db.scalars(select(Document.id).where(Document.owner_id == user.id)).all())

    # 移動先テナント以外のグループ所属を解除（グループはテナント内に閉じるため）
    other_groups = select(Group.id).where(Group.tenant_id != tenant_id)
    db.execute(
        delete(GroupMember).where(
            GroupMember.user_id == user.id, GroupMember.group_id.in_(other_groups)
        )
    )
    # この人へ / この人からの個別共有のうち、テナントをまたぐものを解除
    db.execute(delete(DocumentPermission).where(DocumentPermission.user_id == user.id))
    if doc_ids:
        db.execute(delete(DocumentPermission).where(DocumentPermission.document_id.in_(doc_ids)))
        db.execute(
            Document.__table__.update()
            .where(Document.id.in_(doc_ids))
            .values(tenant_id=tenant_id)
        )
    db.execute(
        Notification.__table__.update()
        .where(Notification.user_id == user.id)
        .values(tenant_id=tenant_id)
    )
    user.tenant_id = tenant_id
    db.commit()

    # 検索索引のテナントも合わせる（索引が古いと検索から漏れる/漏れ出る）
    search.set_tenant([str(i) for i in doc_ids], str(tenant_id))
    return len(doc_ids)
