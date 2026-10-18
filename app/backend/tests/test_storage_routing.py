"""書類の保存先の決め方と、保存先をまたぐ移動。"""

import time
import uuid

import pytest

from app.models.document import Document, Sensitivity, StorageLocation
from app.models.storage_backend import StorageBackend, StorageKind
from app.models.tenant import Tenant
from app.models.user import Role, User
from app.services import storage
from tests.conftest import MemoryStore


@pytest.fixture
def stores(monkeypatch):
    """既定の MinIO（cloud / onprem）をメモリ上の保存先に差し替える。"""
    env = {StorageLocation.cloud: MemoryStore(), StorageLocation.onprem: MemoryStore()}
    monkeypatch.setattr(storage, "_env_stores", env)
    monkeypatch.setattr(storage, "_stores", {})
    return env


def _tenant_with_backend(db, is_onprem: bool) -> tuple[Tenant, StorageBackend]:
    tenant = Tenant(slug=f"t{uuid.uuid4().hex[:6]}", name="家")
    db.add(tenant)
    db.commit()
    backend = StorageBackend(
        tenant_id=tenant.id, kind=StorageKind.webdav, preset="synology", name="NAS",
        config={"url": "https://nas.local:5006/home"}, is_onprem=is_onprem, last_test_ok=True,
    )
    db.add(backend)
    db.commit()
    tenant.storage_backend_id = backend.id
    db.commit()
    return tenant, backend


def _external(backend: StorageBackend) -> MemoryStore:
    store = MemoryStore()
    storage._stores[backend.id] = (time.monotonic(), backend.updated_at, store)
    return store


def _doc(db, tenant: Tenant, sensitivity: Sensitivity) -> Document:
    owner = User(email=f"{uuid.uuid4().hex[:6]}@example.com", name="u", role=Role.admin,
                 hashed_password="x", tenant_id=tenant.id)
    db.add(owner)
    db.commit()
    location, backend_id = storage.resolve_target(db, tenant.id, sensitivity)
    doc = Document(
        id=uuid.uuid4(), tenant_id=tenant.id, title="t", owner_id=owner.id,
        sensitivity=sensitivity, storage_location=location, storage_backend_id=backend_id,
    )
    db.add(doc)
    db.commit()
    return doc


def test_default_minio_when_no_backend(db):
    tenant = Tenant(slug="plain", name="家")
    db.add(tenant)
    db.commit()
    assert storage.resolve_target(db, tenant.id, Sensitivity.internal) == (StorageLocation.cloud, None)
    assert storage.resolve_target(db, tenant.id, Sensitivity.confidential) == (StorageLocation.onprem, None)


def test_cloud_backend_never_receives_confidential(db):
    tenant, backend = _tenant_with_backend(db, is_onprem=False)
    assert storage.resolve_target(db, tenant.id, Sensitivity.internal) == (StorageLocation.cloud, backend.id)
    assert storage.resolve_target(db, tenant.id, Sensitivity.confidential) == (StorageLocation.onprem, None)


def test_onprem_backend_receives_confidential(db):
    tenant, backend = _tenant_with_backend(db, is_onprem=True)
    assert storage.resolve_target(db, tenant.id, Sensitivity.confidential) == (StorageLocation.onprem, backend.id)


def test_objects_go_to_the_documents_backend(db, stores):
    tenant, backend = _tenant_with_backend(db, is_onprem=False)
    external = _external(backend)
    doc = _doc(db, tenant, Sensitivity.internal)
    storage.put_object(doc, f"{doc.id}/pages/000", b"page", "image/jpeg")
    assert external.objects == {f"{doc.id}/pages/000": b"page"}
    assert stores[StorageLocation.cloud].objects == {}
    assert storage.get_object(doc, f"{doc.id}/pages/000") == b"page"

    # 既存の書類（保存先なし）は従来どおり既定の MinIO から読む
    legacy = Document(id=uuid.uuid4(), storage_location=StorageLocation.cloud, storage_backend_id=None)
    stores[StorageLocation.cloud].put(f"{legacy.id}/pages/000", b"old", "image/jpeg")
    assert storage.get_object(legacy, f"{legacy.id}/pages/000") == b"old"


def test_copy_document_to_onprem_when_made_confidential(db, stores):
    tenant, backend = _tenant_with_backend(db, is_onprem=False)
    external = _external(backend)
    doc = _doc(db, tenant, Sensitivity.internal)
    storage.put_object(doc, f"{doc.id}/pages/000", b"page", "image/jpeg")
    storage.put_object(doc, f"{doc.id}/document.pdf", b"%PDF", "application/pdf")

    location, backend_id = storage.resolve_for_change(db, doc, Sensitivity.confidential)
    assert (location, backend_id) == (StorageLocation.onprem, None)
    cleanup = storage.copy_document(doc, location, backend_id)
    assert cleanup is not None
    onprem = stores[StorageLocation.onprem].objects
    assert onprem == {f"{doc.id}/pages/000": b"page", f"{doc.id}/document.pdf": b"%PDF"}
    assert external.objects  # commit まで元は残す
    cleanup()
    assert external.objects == {}


def test_copy_document_noop_when_target_unchanged(db, stores):
    tenant, backend = _tenant_with_backend(db, is_onprem=False)
    _external(backend)
    doc = _doc(db, tenant, Sensitivity.internal)
    location, backend_id = storage.resolve_for_change(db, doc, Sensitivity.public)
    assert storage.copy_document(doc, location, backend_id) is None


def test_sensitivity_change_does_not_pull_old_documents_to_new_backend(db, stores):
    """使用中の保存先を切り替えたあとでも、登録済みの書類は機密度の変更で移さない。"""
    tenant, backend = _tenant_with_backend(db, is_onprem=False)
    _external(backend)
    legacy = Document(
        id=uuid.uuid4(), tenant_id=tenant.id, storage_location=StorageLocation.cloud,
        storage_backend_id=None, sensitivity=Sensitivity.internal,
    )
    assert storage.resolve_for_change(db, legacy, Sensitivity.public) == (StorageLocation.cloud, None)
    # 既定の MinIO 内では従来どおり機密度でバケットを移す
    assert storage.resolve_for_change(db, legacy, Sensitivity.confidential) == (StorageLocation.onprem, None)


def test_confidential_stays_on_onprem_backend(db, stores):
    tenant, backend = _tenant_with_backend(db, is_onprem=True)
    _external(backend)
    doc = _doc(db, tenant, Sensitivity.internal)
    assert storage.resolve_for_change(db, doc, Sensitivity.confidential) == (StorageLocation.onprem, backend.id)
