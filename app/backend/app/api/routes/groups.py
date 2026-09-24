import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_role, require_tenant, tenant_clause, tenant_scope
from app.db.session import get_db
from app.models.group import Group, GroupMember
from app.models.user import User, Role
from app.schemas.group import GroupRead, GroupCreate, GroupUpdate, GroupMemberRead

# グループのマスタ管理 (F-35/F-36)。全エンドポイント管理者限定。
# グループはテナント内に閉じる（メンバーも同一テナントのユーザーのみ）。
router = APIRouter(
    prefix="/groups",
    tags=["groups"],
    dependencies=[Depends(require_role(Role.admin))],
)


def _to_read(db: Session, group: Group) -> GroupRead:
    count = db.scalar(
        select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group.id)
    ) or 0
    return GroupRead(
        id=group.id,
        tenant_id=group.tenant_id,
        name=group.name,
        description=group.description,
        created_at=group.created_at,
        member_count=count,
    )


def _load(db: Session, group_id: uuid.UUID, scope: uuid.UUID | None) -> Group:
    group = db.get(Group, group_id)
    if group is None or (scope is not None and group.tenant_id != scope):
        raise HTTPException(status_code=404, detail="グループが見つかりません")
    return group


@router.get("", response_model=list[GroupRead])
def list_groups(db: Session = Depends(get_db), scope: uuid.UUID | None = Depends(tenant_scope)):
    groups = db.scalars(
        select(Group)
        .where(tenant_clause(Group.tenant_id, scope))
        .order_by(Group.created_at.asc())
    ).all()
    return [_to_read(db, g) for g in groups]


@router.post("", response_model=GroupRead, status_code=201)
def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    if db.scalar(
        select(Group).where(Group.tenant_id == tenant_id, Group.name == payload.name)
    ):
        raise HTTPException(status_code=409, detail="同名のグループが既に存在します")
    group = Group(tenant_id=tenant_id, name=payload.name, description=payload.description)
    db.add(group)
    db.commit()
    db.refresh(group)
    return _to_read(db, group)


@router.patch("/{group_id}", response_model=GroupRead)
def update_group(
    group_id: uuid.UUID,
    payload: GroupUpdate,
    db: Session = Depends(get_db),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    group = _load(db, group_id, scope)
    if payload.name is not None and payload.name != group.name:
        if db.scalar(
            select(Group).where(Group.tenant_id == group.tenant_id, Group.name == payload.name)
        ):
            raise HTTPException(status_code=409, detail="同名のグループが既に存在します")
        group.name = payload.name
    if payload.description is not None:
        group.description = payload.description
    db.commit()
    db.refresh(group)
    return _to_read(db, group)


@router.delete("/{group_id}", status_code=204)
def delete_group(
    group_id: uuid.UUID,
    db: Session = Depends(get_db),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    db.delete(_load(db, group_id, scope))
    db.commit()


@router.get("/{group_id}/members", response_model=list[GroupMemberRead])
def list_members(
    group_id: uuid.UUID,
    db: Session = Depends(get_db),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    _load(db, group_id, scope)
    rows = db.execute(
        select(User)
        .join(GroupMember, GroupMember.user_id == User.id)
        .where(GroupMember.group_id == group_id)
        .order_by(User.name.asc())
    ).scalars().all()
    return [
        GroupMemberRead(user_id=u.id, name=u.name, email=u.email, role=u.role) for u in rows
    ]


@router.put("/{group_id}/members/{user_id}", status_code=204)
def add_member(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    group = _load(db, group_id, scope)
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    if user.tenant_id != group.tenant_id:
        raise HTTPException(status_code=400, detail="別のテナントのユーザーは追加できません")
    exists = db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user_id
        )
    )
    if exists is None:
        db.add(GroupMember(group_id=group_id, user_id=user_id))
        db.commit()


@router.delete("/{group_id}/members/{user_id}", status_code=204)
def remove_member(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    _load(db, group_id, scope)
    member = db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user_id
        )
    )
    if member is not None:
        db.delete(member)
        db.commit()
