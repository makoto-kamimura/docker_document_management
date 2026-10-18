"""保存先の共通インターフェース。

キーは `{doc_id}/pages/000` のような `/` 区切りの相対パスで、各実装が自分の接頭辞 (prefix) を
付けて保存する。呼び出し側（services/storage.py）は保存先の種類を意識しない。
"""

import uuid
from abc import ABC, abstractmethod


class StorageError(Exception):
    """保存先の操作に失敗した。"""


class StorageNotFound(StorageError):
    """指定したキーのオブジェクトが無い。"""


class StorageAuthError(StorageError):
    """認証に失敗した（パスワード変更・連携の解除など。再設定・再連携が必要）。"""


def join_prefix(prefix: str, key: str) -> str:
    prefix = (prefix or "").strip("/")
    return f"{prefix}/{key}" if prefix else key


class ObjectStore(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abstractmethod
    def get(self, key: str) -> bytes:
        """無ければ StorageNotFound を送出する。"""

    @abstractmethod
    def delete(self, key: str) -> None:
        """無くてもエラーにしない。"""

    @abstractmethod
    def list(self, prefix: str) -> list[str]:
        """prefix（例 `{doc_id}/`）配下のキーを、接頭辞を除いた相対キーで返す。"""

    def test(self) -> None:
        """書き込み → 読み出し → 削除 ができるか確かめる（接続テスト）。失敗すれば例外。"""
        key = f"_probe/{uuid.uuid4().hex}.txt"
        body = b"kamilog storage probe"
        self.put(key, body, "text/plain")
        try:
            if self.get(key) != body:
                raise StorageError("書き込んだ内容と読み出した内容が一致しません")
        finally:
            self.delete(key)
