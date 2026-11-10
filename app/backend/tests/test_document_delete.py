"""書類の削除（完全削除, D18）。"""

import pytest
from sqlalchemy import select

from app.models.access_log import AccessLog, Action
from app.models.category import CategoryVisibility
from app.models.document import Document, OcrStatus, StorageLocation
from app.models.document_permission import DocumentPermission, PermissionLevel
from app.models.document_tag import DocumentTag
from app.models.document_version import DocumentVersion
from app.models.family import (
    DocumentAction, ActionStatus, DocumentComment, DocumentInsight, Notification, NotificationKind,
)
from app.models.read_receipt import DocumentReadReceipt
from app.services import search, storage
from app.workers import ocr_worker
from tests.conftest import MemoryStore
from tests.test_category_visibility import _auth, client, w  # noqa: F401 - フィクスチャを共有する

FAMILY = CategoryVisibility.family


@pytest.fixture
def stores(monkeypatch):
    """既定の MinIO をメモリ上の保存先に、検索索引の削除を記録だけに差し替える。"""
    env = {StorageLocation.cloud: MemoryStore(), StorageLocation.onprem: MemoryStore()}
    monkeypatch.setattr(storage, "_env_stores", env)
    monkeypatch.setattr(storage, "_stores", {})
    unindexed: list[str] = []
    monkeypatch.setattr(search, "delete_document", unindexed.append)
    monkeypatch.setattr(search, "index_document", lambda doc_id, body: None)
    return env, unindexed


def _files(stores, doc_id) -> list[str]:
    return [k for k in stores[0][StorageLocation.cloud].objects if k.startswith(f"{doc_id}/")]


def _put_files(stores, doc) -> None:
    cloud = stores[0][StorageLocation.cloud]
    for key in ("pages/000", "proc/000", "preview.jpg", "document.pdf", "v2/pages/000"):
        cloud.put(f"{doc.id}/{key}", b"x", "application/octet-stream")


def _grant(db, doc, user, level):
    db.add(DocumentPermission(document_id=doc.id, user_id=user.id, level=level))
    db.commit()


def _url(doc) -> str:
    return f"/api/v1/documents/{doc.id}"


def test_owner_deletes_everything_about_the_document(client, db, w, stores):  # noqa: F811
    doc, other = w.docs[FAMILY], w.docs["none"]
    _put_files(stores, doc)
    _put_files(stores, other)
    db.add_all([
        DocumentTag(document_id=doc.id, tag="学校"),
        DocumentVersion(document_id=doc.id, version=1, created_by=w.owner.id),
        AccessLog(document_id=doc.id, user_id=w.adult.id, action=Action.view),
        DocumentPermission(document_id=doc.id, user_id=w.loner.id, level=PermissionLevel.view),
        DocumentReadReceipt(document_id=doc.id, user_id=w.adult.id),
        DocumentInsight(document_id=doc.id, keywords=[], reasons=[]),
        DocumentAction(document_id=doc.id, user_id=w.adult.id, status=ActionStatus.seen),
        DocumentComment(document_id=doc.id, user_id=w.adult.id, body="出した"),
        Notification(user_id=w.adult.id, tenant_id=w.a.id, document_id=doc.id,
                     kind=NotificationKind.new_document, title="t"),
    ])
    db.commit()
    doc_id = doc.id

    assert client.delete(_url(doc), headers=_auth(w.owner)).status_code == 204

    db.expire_all()
    assert db.get(Document, doc_id) is None
    assert client.get(f"/api/v1/documents/{doc_id}", headers=_auth(w.owner)).status_code == 404
    for model in (DocumentTag, DocumentVersion, AccessLog, DocumentPermission, DocumentReadReceipt,
                  DocumentInsight, DocumentAction, DocumentComment, Notification):
        assert db.scalars(select(model).where(model.document_id == doc_id)).all() == [], model
    assert _files(stores, doc_id) == []
    assert len(_files(stores, other.id)) == 5  # ほかの書類のファイルは残す
    assert stores[1] == [str(doc_id)]
    titles = {d["title"] for d in client.get("/api/v1/documents", headers=_auth(w.owner)).json()}
    assert "family" not in titles and "none" in titles


def test_who_can_delete(client, db, w, stores):  # noqa: F811
    doc = w.docs[FAMILY]
    # 同じグループで見られるだけの人は消せない
    assert client.delete(_url(doc), headers=_auth(w.adult)).status_code == 403
    _grant(db, doc, w.adult, PermissionLevel.edit)
    assert client.delete(_url(doc), headers=_auth(w.adult)).status_code == 403
    db.execute(DocumentPermission.__table__.delete())
    _grant(db, doc, w.adult, PermissionLevel.delete)
    assert client.delete(_url(doc), headers=_auth(w.adult)).status_code == 204


def test_admin_deletes_within_category_visibility(client, w, stores):  # noqa: F811
    # 「本人だけ」は管理者にも見えないので、存在を伏せて 404
    assert client.delete(_url(w.docs[CategoryVisibility.owner]), headers=_auth(w.admin)).status_code == 404
    assert client.delete(_url(w.docs[FAMILY]), headers=_auth(w.admin)).status_code == 204


def test_other_tenant_cannot_delete(client, w, stores):  # noqa: F811
    assert client.delete(_url(w.docs[FAMILY]), headers=_auth(w.other)).status_code == 404
    # グループ外の人は「家族」の書類を見られないので 404
    assert client.delete(_url(w.docs[FAMILY]), headers=_auth(w.loner)).status_code == 404


def test_can_delete_flag(client, db, w):  # noqa: F811
    def flags(user) -> dict:
        res = client.get("/api/v1/documents", headers=_auth(user)).json()
        return {d["title"]: d["can_delete"] for d in res}

    assert flags(w.owner)["family"] is True
    assert flags(w.admin)["family"] is True
    assert flags(w.adult)["family"] is False
    _grant(db, w.docs[FAMILY], w.adult, PermissionLevel.delete)
    assert flags(w.adult)["family"] is True
    assert flags(w.adult)["none"] is False
    got = client.get(_url(w.docs[FAMILY]), headers=_auth(w.adult)).json()
    assert got["can_delete"] is True


def test_unreachable_storage_does_not_block_deletion(client, db, w, stores, monkeypatch):  # noqa: F811
    doc = w.docs[FAMILY]
    doc_id = doc.id

    def broken_list(prefix):
        raise storage.StorageError("NAS に接続できません")

    monkeypatch.setattr(stores[0][StorageLocation.cloud], "list", broken_list)
    assert client.delete(_url(doc), headers=_auth(w.owner)).status_code == 204
    db.expire_all()
    assert db.get(Document, doc_id) is None


# ---- OCR ワーカーの処理中に削除された場合 ----


def _pending(db, w) -> Document:
    doc = w.docs[FAMILY]
    doc.ocr_status = OcrStatus.pending
    db.commit()
    for other in w.docs.values():  # ワーカーが拾うのはこの1件だけにする
        if other.id != doc.id:
            other.ocr_status = OcrStatus.done
    db.commit()
    return doc


def _delete_row(doc_id) -> None:
    """別の接続から書類を消す（削除 API と同じく、行を消して commit する）。"""
    from app.db.session import SessionLocal

    with SessionLocal() as other:
        other.execute(Document.__table__.delete().where(Document.id == doc_id))
        other.commit()


def test_worker_survives_deletion_during_ocr(db, w, stores, monkeypatch):
    doc = _pending(db, w)
    doc_id = doc.id

    def fake_process(d):
        _delete_row(doc_id)
        return "本文", b"%PDF", b"jpg", {"warnings": []}

    monkeypatch.setattr(ocr_worker, "_process_document", fake_process)
    ocr_worker.process_pending()  # 例外を出さずに終わる
    db.expire_all()
    assert db.get(Document, doc_id) is None
    assert _files(stores, doc_id) == []


def test_worker_removes_artifacts_written_after_deletion(db, w, stores, monkeypatch):
    doc = _pending(db, w)
    doc_id = doc.id
    monkeypatch.setattr(
        ocr_worker, "_process_document", lambda d: ("本文", b"%PDF", b"jpg", {"warnings": []})
    )
    # 索引の登録後・成果物の保存前に削除される
    monkeypatch.setattr(search, "index_document", lambda i, body: _delete_row(doc_id))
    ocr_worker.process_pending()
    db.expire_all()
    assert db.get(Document, doc_id) is None
    assert _files(stores, doc_id) == []
