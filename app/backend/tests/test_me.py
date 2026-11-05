"""自分の表示名の変更（PATCH /auth/me）。"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models.document import Document
from app.models.tenant import Tenant
from app.models.user import Role, User


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def home(db):
    tenant = Tenant(slug="h", name="H家")
    db.add(tenant)
    db.commit()
    child = User(email=f"c-{uuid.uuid4().hex[:6]}@example.com", name="こども", role=Role.viewer,
                 hashed_password="x", tenant_id=tenant.id, is_child=True)
    db.add(child)
    db.commit()
    doc = Document(tenant_id=tenant.id, title="お知らせ", owner_id=child.id)
    db.add(doc)
    db.commit()
    return child, doc


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(str(user.id), user.role.value)}"}


def test_rename_me_shows_everywhere(client, home):
    child, doc = home
    res = client.post(f"/api/v1/documents/{doc.id}/comments", json={"body": "見ました"}, headers=_auth(child))
    assert res.status_code in (200, 201) and res.json()["user_name"] == "こども"

    # 子供アカウントでも自分の名前は変えられる。前後の空白は除く
    res = client.patch("/api/v1/auth/me", json={"name": "  はなこ "}, headers=_auth(child))
    assert res.status_code == 200
    assert res.json()["name"] == "はなこ" and res.json()["tenant_name"] == "H家"
    assert client.get("/api/v1/auth/me", headers=_auth(child)).json()["name"] == "はなこ"
    # 過去のコメントにも新しい名前が出る
    comments = client.get(f"/api/v1/documents/{doc.id}/comments", headers=_auth(child)).json()
    assert [c["user_name"] for c in comments] == ["はなこ"]


def test_rename_me_rejects_blank_and_anonymous(client, home):
    child, _ = home
    for bad in ("", "   ", "x" * 101):
        assert client.patch("/api/v1/auth/me", json={"name": bad}, headers=_auth(child)).status_code == 422
    assert client.patch("/api/v1/auth/me", json={"name": "だれか"}).status_code == 401
