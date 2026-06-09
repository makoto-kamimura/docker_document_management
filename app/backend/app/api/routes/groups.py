import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.group import Group, GroupMember
from app.models.user import User, Role
from app.schemas.group import GroupRead, GroupCreate, GroupUpdate, GroupMemberRead

# グループのマスタ管理 (F-35/F-36)。全エンドポイント管理者限定。
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
        name=group.name,
        description=group.description,
        created_at=group.created_at,
        member_count=count,
    )


@router.get("", response_model=list[GroupRead])
def list_groups(db: Session = Depends(get_db)):
    groups = db.scalars(select(Group).order_by(Group.created_at.asc())).all()
    return [_to_read(db, g) for g in groups]


@router.post("", response_model=GroupRead, status_code=201)
def create_group(payload: GroupCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Group).where(Group.name == payload.name)):
        raise HTTPException(status_code=409, detail="同名のグループが既に存在します")
    group = Group(name=payload.name, description=payload.description)
    db.add(group)
    db.commit()
    db.refresh(group)
    return _to_read(db, group)


@router.patch("/{group_id}", response_model=GroupRead)
def update_group(group_id: uuid.UUID, payload: GroupUpdate, db: Session = Depends(get_db)):
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="グループが見つかりません")
    if payload.name is not None and payload.name != group.name:
        if db.scalar(select(Group).where(Group.name == payload.name)):
            raise HTTPException(status_code=409, detail="同名のグループが既に存在します")
        group.name = payload.name
    if payload.description is not None:
        group.description = payload.description
    db.commit()
    db.refresh(group)
    return _to_read(db, group)


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: uuid.UUID, db: Session = Depends(get_db)):
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="グループが見つかりません")
    db.delete(group)
    db.commit()


@router.get("/{group_id}/members", response_model=list[GroupMemberRead])
def list_members(group_id: uuid.UUID, db: Session = Depends(get_db)):
    if db.get(Group, group_id) is None:
        raise HTTPException(status_code=404, detail="グループが見つかりません")
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
def add_member(group_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    if db.get(Group, group_id) is None:
        raise HTTPException(status_code=404, detail="グループが見つかりません")
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    exists = db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user_id
        )
    )
    if exists is None:
        db.add(GroupMember(group_id=group_id, user_id=user_id))
        db.commit()


@router.delete("/{group_id}/members/{user_id}", status_code=204)
def remove_member(group_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    member = db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user_id
        )
    )
    if member is not None:
        db.delete(member)
        db.commit()
