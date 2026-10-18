import json
import re
import uuid

import httpx
import pytest

from app.services.storage_backends import gdrive
from app.services.storage_backends.base import StorageAuthError, StorageNotFound


class FakeDrive:
    """Google のトークンエンドポイントと Drive API v3 の必要な部分だけを模す。"""

    def __init__(self):
        self.files: dict[str, dict] = {}  # id → {name, parents, mimeType, appProperties, data}
        self.valid_token = "token-1"
        self.refresh_ok = True
        self.token_calls = 0

    def _new(self, meta: dict, data: bytes = b"") -> str:
        fid = uuid.uuid4().hex
        self.files[fid] = {
            "name": meta["name"], "parents": meta.get("parents", []),
            "mimeType": meta.get("mimeType", ""), "appProperties": meta.get("appProperties", {}),
            "data": data,
        }
        return fid

    def _match(self, q: str, f: dict) -> bool:
        if m := re.search(r"value='([^']*)'", q):
            if f["appProperties"].get("dms_key") != m.group(1):
                return False
        if m := re.search(r"name = '([^']*)'", q):
            if f["name"] != m.group(1):
                return False
        if m := re.search(r"'([^']+)' in parents", q):
            if m.group(1) not in f["parents"]:
                return False
        if "mimeType = " in q and f["mimeType"] != gdrive.FOLDER_MIME:
            return False
        return True

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith(gdrive.TOKEN_URL):
            self.token_calls += 1
            if not self.refresh_ok:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": self.valid_token, "expires_in": 3600})
        if request.headers.get("Authorization") != f"Bearer {self.valid_token}":
            return httpx.Response(401)

        path = request.url.path
        params = request.url.params
        if request.method == "GET" and path == "/drive/v3/files":
            q = params["q"]
            hits = [
                {"id": fid, "appProperties": f["appProperties"]}
                for fid, f in self.files.items() if self._match(q, f)
            ]
            return httpx.Response(200, json={"files": hits})
        if request.method == "POST" and path == "/drive/v3/files":
            return httpx.Response(200, json={"id": self._new(json.loads(request.content))})
        if request.method == "POST" and path == "/upload/drive/v3/files":
            boundary = request.headers["Content-Type"].split("boundary=")[1].encode()
            parts = request.content.split(b"--" + boundary)
            meta = json.loads(parts[1].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0])
            data = parts[2].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0]
            return httpx.Response(200, json={"id": self._new(meta, data)})
        fid = path.rsplit("/", 1)[-1]
        if fid not in self.files:
            return httpx.Response(404)
        if request.method == "PATCH":
            self.files[fid]["data"] = request.content
            return httpx.Response(200, json={"id": fid})
        if request.method == "GET" and params.get("alt") == "media":
            return httpx.Response(200, content=self.files[fid]["data"])
        if request.method == "DELETE":
            del self.files[fid]
            return httpx.Response(204)
        return httpx.Response(400)


def _store(server: FakeDrive) -> gdrive.GoogleDriveStore:
    store = gdrive.GoogleDriveStore(
        "cid", "csecret", "refresh", folder_id=None, transport=httpx.MockTransport(server)
    )
    store.create_root_folder()
    return store


def test_put_get_overwrite_list_delete():
    server = FakeDrive()
    store = _store(server)
    store.put("doc1/pages/000", b"page0", "image/jpeg")
    store.put("doc1/document.pdf", b"%PDF", "application/pdf")

    # 「紙ログ/doc1/pages/000」の形で置かれる
    folders = {fid: f for fid, f in server.files.items() if f["mimeType"] == gdrive.FOLDER_MIME}
    assert sorted(f["name"] for f in folders.values()) == ["doc1", gdrive.ROOT_FOLDER_NAME]
    page = next(f for f in server.files.values() if f["appProperties"].get("dms_key") == "doc1/pages/000")
    assert page["name"] == "pages/000"

    assert store.get("doc1/pages/000") == b"page0"
    store.put("doc1/pages/000", b"page0-v2", "image/jpeg")
    assert store.get("doc1/pages/000") == b"page0-v2"
    assert len([f for f in server.files.values() if f["appProperties"]]) == 2  # 上書きで増えない

    assert sorted(store.list("doc1/")) == ["doc1/document.pdf", "doc1/pages/000"]
    assert store.list("doc-none/") == []

    store.delete("doc1/pages/000")
    with pytest.raises(StorageNotFound):
        store.get("doc1/pages/000")


def test_lookup_without_cache_uses_app_properties():
    server = FakeDrive()
    store = _store(server)
    store.put("doc1/mode", b"color", "text/plain")
    fresh = gdrive.GoogleDriveStore(
        "cid", "csecret", "refresh", folder_id=store.folder_id, transport=httpx.MockTransport(server)
    )
    assert fresh.get("doc1/mode") == b"color"


def test_refreshes_expired_access_token():
    server = FakeDrive()
    store = _store(server)
    store.put("doc1/mode", b"color", "text/plain")
    server.valid_token = "token-2"  # 期限前に失効した
    assert store.get("doc1/mode") == b"color"
    assert server.token_calls == 2


def test_revoked_refresh_token():
    server = FakeDrive()
    server.refresh_ok = False
    store = gdrive.GoogleDriveStore(
        "cid", "csecret", "refresh", folder_id="root", transport=httpx.MockTransport(server)
    )
    with pytest.raises(StorageAuthError):
        store.get("doc1/mode")


def test_id_token_email():
    import base64

    payload = base64.urlsafe_b64encode(json.dumps({"email": "a@example.com"}).encode()).decode().rstrip("=")
    assert gdrive.id_token_email({"id_token": f"h.{payload}.s"}) == "a@example.com"
    assert gdrive.id_token_email({}) is None
