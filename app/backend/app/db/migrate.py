"""テナント分離のためのスキーマ移行（Alembic 導入までの暫定措置）。

`create_all` は既存テーブルに列を追加しないため、起動時に冪等なDDLを実行して
`tenant_id` 列とロールの `super_admin` を既存DBへ反映する。すべて IF (NOT) EXISTS 付きで、
何度実行しても安全。PostgreSQL 以外では何もしない。

実行順序 (`app.main.init_db`):
  1. `Base.metadata.create_all` … 新規テーブル(tenants / categories など)の作成
  2. `add_tenant_columns()`      … 既存テーブルへの列追加・ロール追加
     `add_storage_columns()`     … 外部ストレージ連携の列（tenants / documents.storage_backend_id）
     `add_category_columns()`    … カテゴリと全体管理者の列（documents.category_id / users.is_child /
                                    users.active_tenant_id）
  3. シード/バックフィル         … テナント作成と `tenant_id` の充填、旧カテゴリ文字列の移し替え
                                    (`move_free_text_categories`)
  4. `finalize()`                … NOT NULL 制約とテナント内一意制約の付与
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import engine

# tenant_id を持たせるテーブル
_TENANT_TABLES = ("users", "groups", "documents", "notifications")


def _is_postgres() -> bool:
    return engine.dialect.name == "postgresql"


def _exec(sql: str) -> None:
    """DDL を自動コミットで実行する（ALTER TYPE はトランザクション内で扱いにくいため）。"""
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text(sql))


def add_tenant_columns() -> None:
    """既存テーブルへ tenant_id を追加し、ロールに super_admin を足す。"""
    if not _is_postgres():
        return
    # 既存の enum 型 role に新しい値を追加する（新規DBでは create_all が作成済みで no-op）
    _exec("ALTER TYPE role ADD VALUE IF NOT EXISTS 'super_admin'")
    for table in _TENANT_TABLES:
        _exec(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS tenant_id UUID "
            f"REFERENCES tenants(id)"
        )
        _exec(f"CREATE INDEX IF NOT EXISTS ix_{table}_tenant_id ON {table} (tenant_id)")


def add_storage_columns() -> None:
    """外部ストレージ連携の列を既存テーブルへ追加する（storage_backends は create_all が作成）。"""
    if not _is_postgres():
        return
    _exec("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_backend_id UUID")
    _exec(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_backend_id UUID "
        "REFERENCES storage_backends(id)"
    )
    _exec(
        "CREATE INDEX IF NOT EXISTS ix_documents_storage_backend_id "
        "ON documents (storage_backend_id)"
    )


def add_category_columns() -> None:
    """カテゴリ（公開範囲つき）と、全体管理者の操作中のテナントの列を既存テーブルへ追加する。

    categories テーブルは create_all が作成する。
    """
    if not _is_postgres():
        return
    _exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_child BOOLEAN NOT NULL DEFAULT false")
    _exec(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_tenant_id UUID "
        "REFERENCES tenants(id)"
    )
    _exec(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS category_id UUID "
        "REFERENCES categories(id)"
    )
    _exec("CREATE INDEX IF NOT EXISTS ix_documents_category_id ON documents (category_id)")


def move_free_text_categories(db: Session) -> None:
    """旧 `documents.category`（自由入力の文字列）を書類種別へ移し、列を削除する。

    カテゴリは見られる人を決めるようになったため、旧カテゴリの書類はすべて未分類（従来どおりの
    共有範囲）にする。文字は捨てずに、書類種別が空なら書類種別へ、入っていればタグへ移す。
    """
    if not _is_postgres():
        return
    exists = db.scalar(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'documents' AND column_name = 'category'"
        )
    )
    if not exists:
        return
    db.execute(
        text(
            "UPDATE documents SET document_type = category, category = NULL "
            "WHERE category IS NOT NULL AND COALESCE(document_type, '') = ''"
        )
    )
    db.execute(
        text(
            "INSERT INTO document_tags (id, document_id, tag) "
            "SELECT gen_random_uuid(), d.id, d.category FROM documents d "
            "WHERE d.category IS NOT NULL AND NOT EXISTS ("
            "  SELECT 1 FROM document_tags t WHERE t.document_id = d.id AND t.tag = d.category)"
        )
    )
    db.execute(text("UPDATE documents SET category = NULL WHERE category IS NOT NULL"))
    db.commit()
    _exec("ALTER TABLE documents DROP COLUMN IF EXISTS category")
    print("[migrate] documents.category moved to document_type / tags")


def backfill(db: Session, legacy_tenant_id) -> None:
    """テナント導入前のデータを既定テナントへ割り当てる。

    - ユーザー: 未所属なら legacy テナント（super_admin は所属なしのまま）
    - グループ: 未所属なら legacy テナント
    - ドキュメント: 所有者のテナント（不明なら legacy テナント）
    - 通知: 対象ドキュメント → 受信者の順で引き継ぐ
    """
    params = {"t": str(legacy_tenant_id)}
    db.execute(
        text(
            "UPDATE users SET tenant_id = :t "
            "WHERE tenant_id IS NULL AND role <> 'super_admin'"
        ),
        params,
    )
    db.execute(text("UPDATE groups SET tenant_id = :t WHERE tenant_id IS NULL"), params)
    db.execute(
        text(
            "UPDATE documents d SET tenant_id = COALESCE("
            "  (SELECT u.tenant_id FROM users u WHERE u.id = d.owner_id), CAST(:t AS UUID)) "
            "WHERE d.tenant_id IS NULL"
        ),
        params,
    )
    db.execute(
        text(
            "UPDATE notifications n SET tenant_id = COALESCE("
            "  (SELECT d.tenant_id FROM documents d WHERE d.id = n.document_id),"
            "  (SELECT u.tenant_id FROM users u WHERE u.id = n.user_id)) "
            "WHERE n.tenant_id IS NULL"
        )
    )
    db.commit()


def finalize() -> None:
    """バックフィル後の制約付与。データが残っていて失敗する場合はスキップする。"""
    if not _is_postgres():
        return
    # グループ名は「テナント内で一意」へ（旧: 全体で一意）
    _exec("DROP INDEX IF EXISTS ix_groups_name")
    _exec("CREATE INDEX IF NOT EXISTS ix_groups_name ON groups (name)")
    _exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_group_tenant_name "
        "ON groups (tenant_id, name)"
    )
    for table in ("documents", "groups"):
        try:
            _exec(f"ALTER TABLE {table} ALTER COLUMN tenant_id SET NOT NULL")
        except Exception as exc:  # noqa: BLE001 - 未割当行が残っていても起動は止めない
            print(f"[migrate] {table}.tenant_id SET NOT NULL skipped: {exc}")
