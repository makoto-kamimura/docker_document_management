"""ハイブリッドストレージ (F-20) と外部ストレージ連携。

保存先は書類ごとに決まる:
- `documents.storage_backend_id` が NULL … 既定の MinIO。機密度に応じてクラウド(非機密)/
  オンプレ(機密)のバケットへ振り分ける（雛形では S3 互換の MinIO を両系統に見立てている）
- 値がある … テナントが登録した外部の保存先（Cloudflare R2 / Google ドライブ / WebDAV）

新しい書類の保存先は `resolve_target` が決める。テナントが外部の保存先を使用中でも、機密書類は
「自宅内（オンプレ）」として登録された保存先にしか置かない（中身は、外に出さない）。
"""

import threading
import time
import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.document import Document, Sensitivity, StorageLocation
from app.models.storage_backend import StorageBackend
from app.models.tenant import Tenant
from app.services.storage_backends import (
    ObjectStore, S3Store, StorageAuthError, StorageError, StorageNotFound, build_store,
)

__all__ = [
    "StorageError", "StorageNotFound", "StorageAuthError",
    "ensure_buckets", "resolve_location", "resolve_target", "resolve_for_change",
    "put_object", "get_object",
    "store_for_backend", "invalidate", "copy_document",
]

# 外部の保存先の組み立て結果を使い回す（トークンや ID キャッシュを保つため）。
# 設定変更は同じプロセスなら invalidate() で即時、別プロセス（ワーカー等）でも TTL で反映される。
_STORE_TTL_SEC = 60
# backend_id → (確認した時刻, 登録内容の updated_at, 組み立てた保存先)
_stores: dict[uuid.UUID, tuple[float, object, ObjectStore]] = {}
_env_stores: dict[StorageLocation, S3Store] = {}
_lock = threading.Lock()


def _env_store(location: StorageLocation) -> S3Store:
    with _lock:
        if location not in _env_stores:
            _env_stores[location] = S3Store(
                endpoint=settings.s3_endpoint,
                access_key=settings.s3_access_key,
                secret_key=settings.s3_secret_key,
                bucket=_bucket_for(location),
            )
        return _env_stores[location]


def ensure_buckets() -> None:
    """既定の MinIO の保存先バケットが無ければ作成する（冪等）。

    マイグレーション基盤導入までの暫定措置。`docker compose down -v` 等で
    ストレージを初期化した直後でも初回アップロードが失敗しないようにする。
    """
    for location in StorageLocation:
        _env_store(location).ensure_bucket()


def resolve_location(sensitivity: Sensitivity) -> StorageLocation:
    """機密度から保存先の系統を決定する。"""
    if sensitivity == Sensitivity.confidential:
        return StorageLocation.onprem
    return StorageLocation.cloud


def _bucket_for(location: StorageLocation) -> str:
    return (
        settings.s3_bucket_onprem
        if location == StorageLocation.onprem
        else settings.s3_bucket_cloud
    )


def resolve_target(
    db: Session, tenant_id, sensitivity: Sensitivity
) -> tuple[StorageLocation, uuid.UUID | None]:
    """新しい書類（または機密度を変えた書類）の保存先 (系統, 外部保存先ID) を決める。"""
    location = resolve_location(sensitivity)
    tenant = db.get(Tenant, tenant_id) if tenant_id else None
    if tenant is None or tenant.storage_backend_id is None:
        return location, None
    backend = db.get(StorageBackend, tenant.storage_backend_id)
    if backend is None or backend.tenant_id != tenant.id:
        return location, None
    if sensitivity == Sensitivity.confidential and not backend.is_onprem:
        return location, None  # 機密書類は外部（クラウド）の保存先へ出さない
    return location, backend.id


def resolve_for_change(
    db: Session, doc: Document, sensitivity: Sensitivity
) -> tuple[StorageLocation, uuid.UUID | None]:
    """機密度を変えた書類の保存先。今の保存先に置いたままでよければ動かさない。

    使用中の保存先を切り替えても登録済みの書類は移さない方針のため、テナントの現在の保存先へは
    寄せない。移すのは、機密書類がクラウドの保存先に残る場合（→ オンプレへ）と、既定の MinIO 内で
    バケットの系統が変わる場合だけ。
    """
    location = resolve_location(sensitivity)
    if doc.storage_backend_id is None:
        return location, None
    backend = db.get(StorageBackend, doc.storage_backend_id)
    if backend is not None and (sensitivity != Sensitivity.confidential or backend.is_onprem):
        return location, backend.id
    return resolve_target(db, doc.tenant_id, sensitivity)


# ---- 外部の保存先 ----


def store_for_backend(backend: StorageBackend) -> ObjectStore:
    """登録内容から組み立てる（キャッシュする）。登録・更新した直後のテストにも使う。"""
    store = build_store(backend)
    with _lock:
        _stores[backend.id] = (time.monotonic(), backend.updated_at, store)
    return store


def invalidate(backend_id: uuid.UUID) -> None:
    with _lock:
        _stores.pop(backend_id, None)


def _store_by_id(backend_id: uuid.UUID) -> ObjectStore:
    with _lock:
        hit = _stores.get(backend_id)
    if hit and time.monotonic() - hit[0] < _STORE_TTL_SEC:
        return hit[2]
    with SessionLocal() as db:
        backend = db.get(StorageBackend, backend_id)
        if backend is None:
            raise StorageError("書類の保存先が見つかりません（削除された可能性があります）")
        if hit and hit[1] == backend.updated_at:
            # 登録内容が変わっていなければトークン等のキャッシュごと使い続ける
            with _lock:
                _stores[backend_id] = (time.monotonic(), hit[1], hit[2])
            return hit[2]
        return store_for_backend(backend)


def _mark_auth_failed(backend_id: uuid.UUID, exc: Exception) -> None:
    """認証切れを記録し、画面に「再設定・再連携」を出せるようにする。"""
    try:
        with SessionLocal() as db:
            backend = db.get(StorageBackend, backend_id)
            if backend is not None and backend.last_test_ok is not False:
                backend.last_test_ok = False
                backend.last_test_error = str(exc)[:500]
                db.commit()
    except Exception as log_exc:  # noqa: BLE001 - 記録の失敗で本処理の例外を隠さない
        print(f"[storage] failed to record auth error {backend_id}: {log_exc}")


def _store_for(location: StorageLocation, backend_id: uuid.UUID | None) -> ObjectStore:
    return _store_by_id(backend_id) if backend_id else _env_store(location)


def _call(backend_id: uuid.UUID | None, fn: Callable):
    try:
        return fn()
    except StorageAuthError as exc:
        if backend_id:
            invalidate(backend_id)
            _mark_auth_failed(backend_id, exc)
        raise


# ---- 書類のオブジェクト ----


def put_object(doc: Document, key: str, data: bytes, content_type: str) -> None:
    store = _store_for(doc.storage_location, doc.storage_backend_id)
    _call(doc.storage_backend_id, lambda: store.put(key, data, content_type))


def get_object(doc: Document, key: str) -> bytes:
    store = _store_for(doc.storage_location, doc.storage_backend_id)
    return _call(doc.storage_backend_id, lambda: store.get(key))


_CONTENT_TYPES = {
    "jpg": "image/jpeg", "pdf": "application/pdf",
    "txt": "text/plain; charset=utf-8", "json": "application/json",
}


def _guess_content_type(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower() if "." in key.rsplit("/", 1)[-1] else ""
    return _CONTENT_TYPES.get(ext, "application/octet-stream")


def copy_document(
    doc: Document, location: StorageLocation, backend_id: uuid.UUID | None
) -> Callable[[], None] | None:
    """書類のオブジェクトを別の保存先へコピーする（機密度の変更で保存先が変わるとき）。

    保存先が変わらなければ None。変わる場合はコピーを済ませ、元の保存先を消す関数を返す。
    呼び出し側は doc の storage_location / storage_backend_id を書き換えて commit してから、
    その関数を呼ぶ（commit に失敗しても元のオブジェクトが残るように）。
    """
    same = backend_id == doc.storage_backend_id and (
        backend_id is not None or location == doc.storage_location
    )
    if same:
        return None
    src = _store_for(doc.storage_location, doc.storage_backend_id)
    dst = _store_for(location, backend_id)
    keys = _call(doc.storage_backend_id, lambda: src.list(f"{doc.id}/"))
    for key in keys:
        data = _call(doc.storage_backend_id, lambda k=key: src.get(k))
        _call(backend_id, lambda k=key, d=data: dst.put(k, d, _guess_content_type(k)))

    def cleanup() -> None:
        for key in keys:
            try:
                src.delete(key)
            except StorageError as exc:  # 残っても読まれないので処理は止めない
                print(f"[storage] cleanup failed {key}: {exc}")

    return cleanup
