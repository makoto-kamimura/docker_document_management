"""カテゴリの公開範囲と、全体管理者の操作中のテナント。"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import can_access, tenant_scope, visible_documents_clause
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models.category import Category, CategoryVisibility
from app.models.document import Document
from app.models.document_permission import DocumentPermission, PermissionLevel
from app.models.family import Notification, NotificationKind
from app.models.group import Group, GroupMember
from app.models.tenant import Tenant
from app.models.user import Role, User
from app.services import family

V = PermissionLevel.view
E = PermissionLevel.edit


def _user(db, tenant, name, role=Role.registrar, is_child=False, **kw) -> User:
    user = User(email=f"{name}-{uuid.uuid4().hex[:6]}@example.com", name=name, role=role,
                hashed_password="x", tenant_id=tenant.id if tenant else None,
                is_child=is_child, **kw)
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def w(db):
    """家（A）: 登録者・大人・子供が同じグループ、管理者とグループ外の人。別の家（B）。"""
    a = Tenant(slug="a", name="A家")
    b = Tenant(slug="b", name="B家")
    db.add_all([a, b])
    db.commit()
    owner = _user(db, a, "owner")
    adult = _user(db, a, "adult")
    child = _user(db, a, "child", is_child=True)
    admin = _user(db, a, "admin", role=Role.admin)
    loner = _user(db, a, "loner", role=Role.viewer)
    other = _user(db, b, "other", role=Role.admin)
    super_ = _user(db, None, "super", role=Role.super_admin, active_tenant_id=a.id)
    group = Group(tenant_id=a.id, name="家族")
    db.add(group)
    db.commit()
    db.add_all([GroupMember(group_id=group.id, user_id=u.id) for u in (owner, adult, child)])
    cats = {
        v: Category(tenant_id=a.id, name=v.value, visibility=v) for v in CategoryVisibility
    }
    db.add_all(cats.values())
    db.commit()
    docs = {
        v: Document(tenant_id=a.id, title=v.value, owner_id=owner.id, category_id=cats[v].id)
        for v in CategoryVisibility
    }
    docs["none"] = Document(tenant_id=a.id, title="none", owner_id=owner.id)
    docs["b"] = Document(tenant_id=b.id, title="b", owner_id=other.id)
    db.add_all(docs.values())
    db.commit()
    return SimpleNamespace(
        a=a, b=b, owner=owner, adult=adult, child=child, admin=admin, loner=loner, other=other,
        super=super_, group=group, cats=cats, docs=docs,
    )


def _visible(db, user) -> set:
    rows = db.scalars(select(Document.title).where(visible_documents_clause(db, user))).all()
    return set(rows)


ALL_A = {"everyone", "adults", "family", "owner", "none"}

EXPECTED = {
    "owner": ALL_A,
    "adult": {"everyone", "adults", "family", "none"},
    "child": {"everyone", "family", "none"},
    "admin": {"everyone", "adults", "family", "none"},   # 「本人だけ」は管理者でも見られない
    "loner": {"everyone", "adults"},                      # グループ外は「家族」・未分類を見られない
    "super": {"everyone", "adults", "family", "none"},   # 操作中のテナントで管理者と同じ
    "other": {"b"},
}


@pytest.mark.parametrize("who", EXPECTED)
def test_view_follows_category_visibility(db, w, who):
    user = getattr(w, who)
    assert _visible(db, user) == EXPECTED[who]
    # SQL の条件と can_access が一致する
    assert {d.title for d in w.docs.values() if can_access(db, d, user, V)} == EXPECTED[who]


def _grant(db, doc, user, level):
    db.add(DocumentPermission(document_id=doc.id, user_id=user.id, level=level))
    db.commit()


def test_sharing_cannot_widen_beyond_the_category(db, w):
    d = w.docs
    _grant(db, d[CategoryVisibility.adults], w.child, PermissionLevel.delete)
    _grant(db, d[CategoryVisibility.owner], w.adult, PermissionLevel.delete)
    _grant(db, d[CategoryVisibility.family], w.loner, V)
    assert not can_access(db, d[CategoryVisibility.adults], w.child, V)
    assert not can_access(db, d[CategoryVisibility.owner], w.adult, V)
    assert can_access(db, d[CategoryVisibility.family], w.loner, V)
    assert "family" in _visible(db, w.loner)
    assert "adults" not in _visible(db, w.child)


def test_edit_needs_owner_admin_or_grant(db, w):
    d = w.docs
    assert not can_access(db, d[CategoryVisibility.everyone], w.adult, E)
    _grant(db, d[CategoryVisibility.everyone], w.adult, E)
    assert can_access(db, d[CategoryVisibility.everyone], w.adult, E)
    assert can_access(db, d[CategoryVisibility.adults], w.admin, E)
    assert not can_access(db, d[CategoryVisibility.owner], w.admin, E)
    assert can_access(db, d[CategoryVisibility.owner], w.owner, E)


def test_super_admin_works_inside_the_active_tenant_only(db, w):
    assert not can_access(db, w.docs["b"], w.super, V)
    w.super.active_tenant_id = w.b.id
    db.commit()
    assert _visible(db, w.super) == {"b"}
    assert not can_access(db, w.docs[CategoryVisibility.everyone], w.super, V)
    w.super.active_tenant_id = None
    db.commit()
    assert _visible(db, w.super) == set()
    with pytest.raises(HTTPException) as exc:
        tenant_scope(w.super)
    assert exc.value.status_code == 409


def test_family_follows_category_visibility(db, w):
    d = w.docs
    _grant(db, d[CategoryVisibility.family], w.loner, V)
    fam = family.family_ids_map(db, list(d.values()))
    tenant_a = [w.owner.id, w.adult.id, w.child.id, w.admin.id, w.loner.id]
    assert fam[d[CategoryVisibility.everyone].id] == tenant_a
    assert fam[d[CategoryVisibility.adults].id] == [u for u in tenant_a if u != w.child.id]
    assert fam[d[CategoryVisibility.owner].id] == [w.owner.id]
    # 「家族」・未分類はグループの同居メンバー（順不同）と個別共有先。所有者が先頭
    assert fam[d[CategoryVisibility.family].id][0] == w.owner.id
    assert set(fam[d[CategoryVisibility.family].id]) == {w.owner.id, w.adult.id, w.child.id, w.loner.id}
    assert fam[d["none"].id][0] == w.owner.id
    assert set(fam[d["none"].id]) == {w.owner.id, w.adult.id, w.child.id}


# ---- API ----


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(str(user.id), user.role.value)}"}


def test_tenant_api_is_super_admin_only(client, w):
    assert client.get("/api/v1/tenants", headers=_auth(w.admin)).status_code == 403
    assert client.get("/api/v1/tenants", headers=_auth(w.super)).status_code == 200


def test_switching_tenant_changes_what_super_admin_sees(client, db, w):
    res = client.get("/api/v1/documents", headers=_auth(w.super))
    assert {d["title"] for d in res.json()} == EXPECTED["super"]
    res = client.put("/api/v1/tenants/active", json={"tenant_id": str(w.b.id)}, headers=_auth(w.super))
    assert res.status_code == 200
    me = client.get("/api/v1/auth/me", headers=_auth(w.super)).json()
    assert me["tenant_id"] == str(w.b.id) and me["tenant_name"] == "B家"
    assert [d["title"] for d in client.get("/api/v1/documents", headers=_auth(w.super)).json()] == ["b"]
    # X-Tenant-Id ヘッダではもう切り替えられない
    res = client.get("/api/v1/documents", headers={**_auth(w.super), "X-Tenant-Id": str(w.a.id)})
    assert [d["title"] for d in res.json()] == ["b"]


def test_hidden_document_is_404(client, w):
    doc = w.docs[CategoryVisibility.owner]
    assert client.get(f"/api/v1/documents/{doc.id}", headers=_auth(w.admin)).status_code == 404
    assert client.get(f"/api/v1/documents/{doc.id}", headers=_auth(w.owner)).status_code == 200


def test_category_management(client, db, w):
    body = {"name": "学校", "visibility": "family"}
    assert client.post("/api/v1/categories", json=body, headers=_auth(w.owner)).status_code == 403
    res = client.post("/api/v1/categories", json=body, headers=_auth(w.admin))
    assert res.status_code == 201
    assert client.post("/api/v1/categories", json=body, headers=_auth(w.admin)).status_code == 409
    # 書類が入っているカテゴリ（管理者から見えない「本人だけ」も含む）は削除できない
    used = w.cats[CategoryVisibility.owner]
    assert client.delete(f"/api/v1/categories/{used.id}", headers=_auth(w.admin)).status_code == 400
    assert client.delete(f"/api/v1/categories/{res.json()['id']}", headers=_auth(w.admin)).status_code == 204
    # 件数はその人が見られる書類だけ
    counts = {c["name"]: c["document_count"] for c in client.get("/api/v1/categories", headers=_auth(w.admin)).json()}
    assert counts["owner"] == 0 and counts["everyone"] == 1


def test_document_category_must_be_in_the_tenant(client, db, w):
    doc = w.docs["none"]
    b_cat = Category(tenant_id=w.b.id, name="B", visibility=CategoryVisibility.everyone)
    db.add(b_cat)
    db.commit()
    url = f"/api/v1/documents/{doc.id}"
    assert client.patch(url, json={"category_id": str(b_cat.id)}, headers=_auth(w.owner)).status_code == 400
    owner_only = w.cats[CategoryVisibility.owner]
    res = client.patch(url, json={"category_id": str(owner_only.id)}, headers=_auth(w.owner))
    assert res.status_code == 200
    assert res.json()["category"] == "owner" and res.json()["category_visibility"] == "owner"
    assert client.get(url, headers=_auth(w.adult)).status_code == 404


def test_new_tenant_gets_sample_categories_and_users_move_from_tenant_menu(client, db, w):
    res = client.post("/api/v1/tenants", json={"slug": "c", "name": "C家"}, headers=_auth(w.super))
    assert res.status_code == 201
    tid = uuid.UUID(res.json()["id"])
    names = db.scalars(select(Category.name).where(Category.tenant_id == tid)).all()
    assert set(names) == {"投函チラシ", "重要書類", "処方箋", "取扱説明書"}
    res = client.put(f"/api/v1/tenants/{tid}/users/{w.loner.id}", headers=_auth(w.super))
    assert res.status_code == 200 and res.json()["tenant_id"] == str(tid)
    users = client.get(f"/api/v1/tenants/{tid}/users", headers=_auth(w.super)).json()
    assert [u["name"] for u in users] == ["loner"]


def test_moving_a_user_leaves_notifications_about_others_documents_behind(client, db, w):
    mine = Document(tenant_id=w.a.id, title="自分の紙", owner_id=w.adult.id)
    db.add(mine)
    db.commit()

    def notify(doc, title):
        db.add(Notification(user_id=w.adult.id, tenant_id=w.a.id, document_id=doc.id if doc else None,
                            kind=NotificationKind.new_document, title=title, body=""))

    notify(w.docs[CategoryVisibility.family], "家に残る紙")
    notify(mine, "自分の紙")
    notify(None, "書類なし")
    db.commit()

    res = client.put(f"/api/v1/tenants/{w.b.id}/users/{w.adult.id}", headers=_auth(w.super))
    assert res.status_code == 200
    rows = db.execute(
        select(Notification.title, Notification.tenant_id).where(Notification.user_id == w.adult.id)
    ).all()
    # 元のテナントの書類のタイトルは移動先へ持ち出さない。本人の書類と書類なしの通知は一緒に移る
    assert {r.title: r.tenant_id for r in rows} == {"自分の紙": w.b.id, "書類なし": w.b.id}


def test_category_icon_and_color(client, db, w):
    body = {"name": "学校", "visibility": "family", "icon": "school", "color": "sky"}
    res = client.post("/api/v1/categories", json=body, headers=_auth(w.admin))
    assert res.status_code == 201
    assert res.json()["icon"] == "school" and res.json()["color"] == "sky"
    cid = res.json()["id"]
    res = client.patch(f"/api/v1/categories/{cid}", json={"icon": "book", "color": "violet"}, headers=_auth(w.admin))
    assert res.status_code == 200 and (res.json()["icon"], res.json()["color"]) == ("book", "violet")
    # 名前だけ変えてもアイコン・色は残る
    res = client.patch(f"/api/v1/categories/{cid}", json={"name": "学校のプリント"}, headers=_auth(w.admin))
    assert (res.json()["icon"], res.json()["color"]) == ("book", "violet")
    # 決まった形以外は受け付けない
    for bad in ({"icon": "Book!"}, {"icon": "x" * 41}, {"color": "pink"}):
        assert client.patch(f"/api/v1/categories/{cid}", json=bad, headers=_auth(w.admin)).status_code == 422
    # 書類の一覧にもカテゴリのアイコン・色が付く
    doc = w.docs["none"]
    client.patch(f"/api/v1/documents/{doc.id}", json={"category_id": cid}, headers=_auth(w.owner))
    got = client.get(f"/api/v1/documents/{doc.id}", headers=_auth(w.owner)).json()
    assert (got["category_icon"], got["category_color"]) == ("book", "violet")


def test_sample_categories_have_icons(client, db, w):
    res = client.post("/api/v1/tenants", json={"slug": "d", "name": "D家"}, headers=_auth(w.super))
    tid = uuid.UUID(res.json()["id"])
    rows = db.execute(select(Category.name, Category.icon, Category.color).where(Category.tenant_id == tid)).all()
    assert {r.name: (r.icon, r.color) for r in rows} == {
        "投函チラシ": ("newspaper", "amber"),
        "重要書類": ("shield-checkmark", "indigo"),
        "処方箋": ("medkit", "rose"),
        "取扱説明書": ("book", "emerald"),
    }
