"""テスト共通設定。

DB は使い捨ての SQLite、暗号鍵はテスト用に生成したものを使う。設定は import 時に読まれるため、
アプリを import する前に環境変数を入れる。
"""

import os
import tempfile

from cryptography.fernet import Fernet

_tmp = tempfile.mkdtemp(prefix="dms-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["STORAGE_SECRET_KEY"] = Fernet.generate_key().decode()
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "test-client")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_SECRET", "test-secret")

import pytest  # noqa: E402

from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.services.storage_backends.base import ObjectStore, StorageNotFound  # noqa: E402
import app.main  # noqa: E402,F401 - 全モデルをメタデータへ登録する


class MemoryStore(ObjectStore):
    """テスト用のメモリ上の保存先。"""

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def put(self, key, data, content_type):
        self.objects[key] = data

    def get(self, key):
        if key not in self.objects:
            raise StorageNotFound(key)
        return self.objects[key]

    def delete(self, key):
        self.objects.pop(key, None)

    def list(self, prefix):
        return [k for k in self.objects if k.startswith(prefix)]


@pytest.fixture
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        yield session
