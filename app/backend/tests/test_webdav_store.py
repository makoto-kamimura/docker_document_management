from urllib.parse import unquote

import httpx
import pytest

from app.services.storage_backends.base import StorageAuthError, StorageNotFound
from app.services.storage_backends.webdav import WebDAVStore

BASE_PATH = "/home/kamilog"


class FakeDav:
    """Synology の WebDAV Server を模した最小限のサーバー（MKCOL / PUT / GET / DELETE / PROPFIND）。"""

    def __init__(self, password="pw"):
        self.password = password
        self.dirs = {BASE_PATH}
        self.files: dict[str, bytes] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        auth = request.headers.get("Authorization", "")
        if auth != httpx.BasicAuth("user", self.password)._auth_header:
            return httpx.Response(401)
        path = unquote(request.url.path).rstrip("/")
        parent = path.rsplit("/", 1)[0]
        if request.method == "MKCOL":
            if path in self.dirs:
                return httpx.Response(405)
            if parent not in self.dirs:
                return httpx.Response(409)
            self.dirs.add(path)
            return httpx.Response(201)
        if request.method == "PUT":
            if parent not in self.dirs:
                return httpx.Response(409)
            self.files[path] = request.content
            return httpx.Response(201)
        if request.method == "GET":
            if path not in self.files:
                return httpx.Response(404)
            return httpx.Response(200, content=self.files[path])
        if request.method == "DELETE":
            if self.files.pop(path, None) is None:
                return httpx.Response(404)
            return httpx.Response(204)
        if request.method == "PROPFIND":
            if path not in self.dirs:
                return httpx.Response(404)
            entries = [(path + "/", True)]
            entries += [(d + "/", True) for d in self.dirs if d.rsplit("/", 1)[0] == path]
            entries += [(f, False) for f in self.files if f.rsplit("/", 1)[0] == path]
            body = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' + "".join(
                f"<d:response><d:href>{href}</d:href><d:propstat><d:prop><d:resourcetype>"
                f"{'<d:collection/>' if is_dir else ''}</d:resourcetype></d:prop></d:propstat></d:response>"
                for href, is_dir in entries
            ) + "</d:multistatus>"
            return httpx.Response(207, content=body.encode())
        return httpx.Response(405)


def _store(server, password="pw"):
    return WebDAVStore(
        f"https://nas.local:5006{BASE_PATH}", "user", password, prefix="dms/",
        transport=httpx.MockTransport(server),
    )


def test_put_get_list_delete():
    server = FakeDav()
    store = _store(server)
    store.put("doc1/pages/000", b"page0", "image/jpeg")
    store.put("doc1/proc/000", b"proc0", "image/jpeg")
    store.put("doc1/document.pdf", b"%PDF", "application/pdf")
    store.put("doc2/pages/000", b"other", "image/jpeg")

    assert f"{BASE_PATH}/dms/doc1/pages/000" in server.files
    assert store.get("doc1/pages/000") == b"page0"
    assert sorted(store.list("doc1/")) == ["doc1/document.pdf", "doc1/pages/000", "doc1/proc/000"]

    store.delete("doc1/pages/000")
    store.delete("doc1/pages/000")  # 無くてもエラーにしない
    with pytest.raises(StorageNotFound):
        store.get("doc1/pages/000")


def test_list_missing_folder_is_empty():
    assert _store(FakeDav()).list("nothing/") == []


def test_connection_test_cleans_up():
    server = FakeDav()
    _store(server).test()
    assert server.files == {}


def test_wrong_password():
    with pytest.raises(StorageAuthError):
        _store(FakeDav(), password="wrong").put("a/b", b"x", "text/plain")
