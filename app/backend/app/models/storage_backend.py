import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class StorageKind(str, enum.Enum):
    s3 = "s3"            # S3 互換（Cloudflare R2 / MinIO / その他）
    webdav = "webdav"    # WebDAV（Synology NAS の WebDAV Server など）
    gdrive = "gdrive"    # Google ドライブ（OAuth で連携した利用者自身のドライブ）


class StorageBackend(Base):
    """テナントが登録した外部の保存先（外部ストレージ連携）。

    テナントは登録済みの保存先から1つを「使用中」(`tenants.storage_backend_id`) に選び、以後に
    登録する書類はそこへ保存する。書類は保存した時点の保存先を `documents.storage_backend_id` に
    記録するため、使用中の保存先を切り替えても既存の書類は元の場所から読める。

    認証情報は `secret_encrypted`（Fernet で暗号化した JSON）にだけ保存し、`config` には
    エンドポイントやバケット名など秘密でない値を入れる。
    """

    __tablename__ = "storage_backends"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"), index=True)
    kind: Mapped[StorageKind] = mapped_column(Enum(StorageKind, name="storage_kind"))
    # 画面表示用の種類（r2 / synology / s3 / gdrive）。動作は kind で決まる
    preset: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(100))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 自宅内など外部に出ない保存先か。True のときだけ機密書類 (confidential) を保存する
    is_onprem: Mapped[bool] = mapped_column(Boolean, default=False)

    last_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_test_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
