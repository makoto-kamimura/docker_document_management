"""外部ストレージ連携（テナントごとの保存先: Cloudflare R2 / Google ドライブ / Synology NAS）。

テナント管理者が保存先を登録・接続テストし、1つを「使用中」にする。以後に登録する書類は
その保存先へ保存される（既存の書類は元の保存先のまま）。super_admin は X-Tenant-Id で対象を選ぶ。

デモテナントは公開アカウントで誰でも管理者として入れるため、登録・変更を禁止する
（任意の URL へサーバーから通信させる踏み台にされないように）。
"""

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_role, require_tenant
from app.core.config import settings
from app.core.crypto import SecretKeyMissing, decrypt_json, encrypt_json
from app.db.session import get_db
from app.models.document import Document
from app.models.storage_backend import StorageBackend, StorageKind
from app.models.tenant import Tenant
from app.models.user import ADMIN_ROLES, Role, User
from app.schemas.storage import (
    ActiveStorageUpdate, AuthorizeUrl, StorageBackendCreate, StorageBackendRead,
    StorageBackendUpdate, StorageOverview, StorageTestResult,
)
from app.services import storage
from app.services.storage_backends import gdrive

router = APIRouter(
    prefix="/storage", tags=["storage"], dependencies=[Depends(require_role(Role.admin))]
)
# Google から戻ってくるリダイレクト先はブラウザ遷移なので Bearer 認証を付けられない。
# 代わりに authorize で発行した署名付き state で利用者とテナントを確かめる。
callback_router = APIRouter(prefix="/storage", tags=["storage"])

# 種類ごとの (kind, 設定の必須項目, 設定の任意項目, 認証情報の必須項目)
_PRESETS: dict[str, tuple[StorageKind, set, set, set]] = {
    "r2": (StorageKind.s3, {"account_id", "bucket"}, {"prefix"}, {"access_key", "secret_key"}),
    "s3": (StorageKind.s3, {"endpoint", "bucket"}, {"region", "prefix"}, {"access_key", "secret_key"}),
    "synology": (StorageKind.webdav, {"url"}, {"verify_tls", "prefix"}, {"username", "password"}),
}

# 「自宅内（オンプレ）」として機密書類を置けるのは、自分で設置する保存先だけ
# （R2・Google ドライブは常にクラウド扱い）
_ONPREM_CAPABLE = {"synology", "s3"}

_STATE_PURPOSE = "storage-gdrive"
_STATE_TTL = timedelta(minutes=10)


# ---- 共通 ----


def _tenant(db: Session, tenant_id: uuid.UUID) -> Tenant:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="テナントが見つかりません")
    return tenant


def _ensure_editable(tenant: Tenant) -> None:
    if tenant.is_demo:
        raise HTTPException(status_code=403, detail="デモテナントでは保存先を変更できません")


def _backend(db: Session, tenant: Tenant, backend_id: uuid.UUID) -> StorageBackend:
    backend = db.get(StorageBackend, backend_id)
    if backend is None or backend.tenant_id != tenant.id:
        raise HTTPException(status_code=404, detail="保存先が見つかりません")
    return backend


def _to_read(db: Session, tenant: Tenant, backends: list[StorageBackend]) -> list[StorageBackendRead]:
    ids = [b.id for b in backends]
    counts = dict(
        db.execute(
            select(Document.storage_backend_id, func.count())
            .where(Document.storage_backend_id.in_(ids))
            .group_by(Document.storage_backend_id)
        ).all()
    ) if ids else {}
    return [
        StorageBackendRead(
            id=b.id,
            kind=b.kind.value,
            preset=b.preset,
            name=b.name,
            config=b.config or {},
            is_onprem=b.is_onprem,
            has_secret=bool(b.secret_encrypted),
            is_active=tenant.storage_backend_id == b.id,
            document_count=counts.get(b.id, 0),
            last_test_ok=b.last_test_ok,
            last_test_error=b.last_test_error,
            last_tested_at=b.last_tested_at,
            created_at=b.created_at,
        )
        for b in backends
    ]


def _clean(values: dict, allowed: set) -> dict:
    out = {}
    for k in allowed:
        v = values.get(k)
        if isinstance(v, str):
            v = v.strip()
        if v not in (None, ""):
            out[k] = v
    return out


def _validate_config(preset: str, config: dict) -> dict:
    _, required, optional, _ = _PRESETS[preset]
    cfg = _clean(config, required | optional)
    missing = [k for k in required if k not in cfg]
    if missing:
        raise HTTPException(status_code=422, detail=f"未入力の項目があります: {', '.join(sorted(missing))}")
    for key in ("endpoint", "url"):
        if key in cfg:
            parts = urlsplit(cfg[key])
            if parts.scheme not in ("http", "https") or not parts.netloc:
                raise HTTPException(status_code=422, detail=f"{key} は http(s):// から始まる URL を指定してください")
    if "verify_tls" in cfg:
        cfg["verify_tls"] = bool(cfg["verify_tls"])
    return cfg


def _encrypt(secret: dict) -> str:
    try:
        return encrypt_json(secret)
    except SecretKeyMissing as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _run_test(db: Session, backend: StorageBackend) -> tuple[bool, str | None]:
    """接続テスト（書き込み→読み出し→削除）を行い、結果を記録する。"""
    storage.invalidate(backend.id)
    try:
        storage.store_for_backend(backend).test()
        ok, error = True, None
    except Exception as exc:  # noqa: BLE001 - 失敗理由はそのまま画面に出す
        ok, error = False, str(exc)[:500] or exc.__class__.__name__
    backend.last_test_ok = ok
    backend.last_test_error = error
    backend.last_tested_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(backend)
    return ok, error


# ---- 保存先の一覧・登録 ----


@router.get("", response_model=StorageOverview)
def get_overview(db: Session = Depends(get_db), tenant_id: uuid.UUID = Depends(require_tenant)):
    tenant = _tenant(db, tenant_id)
    backends = list(
        db.scalars(
            select(StorageBackend)
            .where(StorageBackend.tenant_id == tenant.id)
            .order_by(StorageBackend.created_at.asc())
        ).all()
    )
    return StorageOverview(
        active_backend_id=tenant.storage_backend_id,
        backends=_to_read(db, tenant, backends),
        secret_key_configured=bool(settings.storage_secret_key),
        google_enabled=bool(settings.google_oauth_client_id and settings.google_oauth_client_secret),
        editable=not tenant.is_demo,
    )


@router.post("/backends", response_model=StorageTestResult, status_code=201)
def create_backend(
    payload: StorageBackendCreate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    """保存先を登録し、そのまま接続テストする（失敗しても登録は残し、修正できるようにする）。"""
    tenant = _tenant(db, tenant_id)
    _ensure_editable(tenant)
    kind, _, _, secret_keys = _PRESETS[payload.preset]
    config = _validate_config(payload.preset, payload.config)
    secret = _clean(payload.secret, secret_keys)
    missing = [k for k in secret_keys if k not in secret]
    if missing:
        raise HTTPException(status_code=422, detail=f"認証情報が未入力です: {', '.join(sorted(missing))}")
    backend = StorageBackend(
        tenant_id=tenant.id,
        kind=kind,
        preset=payload.preset,
        name=payload.name.strip(),
        config=config,
        secret_encrypted=_encrypt(secret),
        is_onprem=payload.is_onprem and payload.preset in _ONPREM_CAPABLE,
    )
    db.add(backend)
    db.commit()
    db.refresh(backend)
    ok, error = _run_test(db, backend)
    return StorageTestResult(ok=ok, error=error, backend=_to_read(db, tenant, [backend])[0])


@router.patch("/backends/{backend_id}", response_model=StorageTestResult)
def update_backend(
    backend_id: uuid.UUID,
    payload: StorageBackendUpdate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    """設定を更新して接続テストし直す。認証情報は入力した項目だけ差し替える。"""
    tenant = _tenant(db, tenant_id)
    _ensure_editable(tenant)
    backend = _backend(db, tenant, backend_id)
    if payload.name is not None:
        backend.name = payload.name.strip()
    if payload.is_onprem is not None:
        backend.is_onprem = payload.is_onprem and backend.preset in _ONPREM_CAPABLE
    if backend.preset in _PRESETS:
        if payload.config is not None:
            # 保存先フォルダ (folder_id) 等、画面に出さない値は残す
            backend.config = {**(backend.config or {}), **_validate_config(backend.preset, payload.config)}
        if payload.secret:
            _, _, _, secret_keys = _PRESETS[backend.preset]
            try:
                current = decrypt_json(backend.secret_encrypted)
            except SecretKeyMissing as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            backend.secret_encrypted = _encrypt({**current, **_clean(payload.secret, secret_keys)})
    db.commit()
    db.refresh(backend)
    ok, error = _run_test(db, backend)
    return StorageTestResult(ok=ok, error=error, backend=_to_read(db, tenant, [backend])[0])


@router.delete("/backends/{backend_id}", status_code=204)
def delete_backend(
    backend_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    """書類が1件も保存されていない保存先だけ削除できる（書類が読めなくならないように）。"""
    tenant = _tenant(db, tenant_id)
    _ensure_editable(tenant)
    backend = _backend(db, tenant, backend_id)
    used = db.scalar(
        select(func.count()).select_from(Document).where(Document.storage_backend_id == backend.id)
    )
    if used:
        raise HTTPException(
            status_code=409, detail=f"この保存先には {used} 件の書類が保存されているため削除できません"
        )
    if tenant.storage_backend_id == backend.id:
        tenant.storage_backend_id = None
    db.delete(backend)
    db.commit()
    storage.invalidate(backend_id)


@router.post("/backends/{backend_id}/test", response_model=StorageTestResult)
def test_backend(
    backend_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    tenant = _tenant(db, tenant_id)
    backend = _backend(db, tenant, backend_id)
    ok, error = _run_test(db, backend)
    return StorageTestResult(ok=ok, error=error, backend=_to_read(db, tenant, [backend])[0])


@router.put("/active", response_model=StorageOverview)
def set_active(
    payload: ActiveStorageUpdate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    """新しく登録する書類の保存先を切り替える。接続テストに成功した保存先だけ選べる。"""
    tenant = _tenant(db, tenant_id)
    _ensure_editable(tenant)
    if payload.backend_id is not None:
        backend = _backend(db, tenant, payload.backend_id)
        if not backend.last_test_ok:
            raise HTTPException(
                status_code=400, detail="接続テストに成功した保存先だけ使用中にできます"
            )
    tenant.storage_backend_id = payload.backend_id
    db.commit()
    return get_overview(db, tenant_id)


# ---- Google ドライブ連携 (OAuth) ----


def _google_ready() -> None:
    if not (settings.google_oauth_client_id and settings.google_oauth_client_secret):
        raise HTTPException(
            status_code=400,
            detail="Google ドライブ連携がサーバーで設定されていません（GOOGLE_OAUTH_CLIENT_ID / SECRET）",
        )


@router.get("/google/authorize", response_model=AuthorizeUrl)
def google_authorize(
    backend_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin)),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    """Google の同意画面の URL を返す。backend_id を付けると既存の連携をつなぎ直す（再連携）。"""
    _google_ready()
    tenant = _tenant(db, tenant_id)
    _ensure_editable(tenant)
    if not settings.storage_secret_key:
        raise HTTPException(status_code=400, detail="STORAGE_SECRET_KEY が未設定のため連携できません")
    if backend_id is not None:
        backend = _backend(db, tenant, backend_id)
        if backend.kind != StorageKind.gdrive:
            raise HTTPException(status_code=400, detail="Google ドライブの保存先ではありません")
    state = jwt.encode(
        {
            "purpose": _STATE_PURPOSE,
            "tenant": str(tenant.id),
            "user": str(user.id),
            "backend": str(backend_id) if backend_id else None,
            "exp": datetime.now(timezone.utc) + _STATE_TTL,
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return AuthorizeUrl(
        url=gdrive.authorize_url(
            settings.google_oauth_client_id, settings.google_oauth_redirect_uri, state
        )
    )


def _back_to_web(status: str, message: str = "") -> RedirectResponse:
    query = urlencode({"google": status, **({"message": message} if message else {})})
    return RedirectResponse(f"{settings.web_base_url.rstrip('/')}/storage?{query}", status_code=302)


@callback_router.get("/google/callback")
def google_callback(
    state: str = "",
    code: str = "",
    error: str = "",
    db: Session = Depends(get_db),
):
    """Google の同意画面から戻ってくる。トークンを暗号化して保存し、Web の設定画面へ戻す。"""
    try:
        claims = jwt.decode(state, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if claims.get("purpose") != _STATE_PURPOSE:
            raise JWTError("purpose")
    except JWTError:
        return _back_to_web("error", "連携の有効期限が切れました。もう一度お試しください")
    if error or not code:
        return _back_to_web("error", "Google での許可がキャンセルされました")

    tenant = db.get(Tenant, uuid.UUID(claims["tenant"]))
    user = db.get(User, uuid.UUID(claims["user"]))
    # state の発行後に権限が外れていないか確かめる
    if (
        tenant is None or tenant.is_demo or user is None or user.role not in ADMIN_ROLES
        or (user.role != Role.super_admin and user.tenant_id != tenant.id)
    ):
        return _back_to_web("error", "この操作を行う権限がありません")

    try:
        token = gdrive.exchange_code(
            settings.google_oauth_client_id, settings.google_oauth_client_secret,
            settings.google_oauth_redirect_uri, code,
        )
        email = gdrive.id_token_email(token)
        secret = _encrypt({"refresh_token": token["refresh_token"]})
        backend = None
        if claims.get("backend"):
            backend = db.get(StorageBackend, uuid.UUID(claims["backend"]))
            if backend is None or backend.tenant_id != tenant.id:
                return _back_to_web("error", "再連携する保存先が見つかりません")
            old_email = (backend.config or {}).get("account_email")
            if old_email and email and old_email != email:
                # 別アカウントだと保存済みの書類を読めなくなる（drive.file はアプリが作ったファイルのみ）
                return _back_to_web(
                    "error", f"前回と同じ Google アカウント（{old_email}）で連携してください"
                )
            backend.secret_encrypted = secret
            backend.config = {**(backend.config or {}), "account_email": email}
        else:
            store = gdrive.GoogleDriveStore(
                settings.google_oauth_client_id, settings.google_oauth_client_secret,
                token["refresh_token"], folder_id=None,
            )
            folder_id = store.create_root_folder()
            backend = StorageBackend(
                tenant_id=tenant.id,
                kind=StorageKind.gdrive,
                preset="gdrive",
                name=f"Google ドライブ（{email}）" if email else "Google ドライブ",
                config={"folder_id": folder_id, "account_email": email},
                secret_encrypted=secret,
                is_onprem=False,
            )
            db.add(backend)
        db.commit()
        db.refresh(backend)
    except (storage.StorageError, HTTPException) as exc:
        db.rollback()
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        return _back_to_web("error", str(detail)[:200])

    ok, err = _run_test(db, backend)
    return _back_to_web("ok" if ok else "error", "" if ok else f"接続テストに失敗しました: {err}"[:200])
