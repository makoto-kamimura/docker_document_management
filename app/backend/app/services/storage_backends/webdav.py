"""WebDAV の保存先（Synology NAS の「WebDAV Server」パッケージなど）。

`url` には共有フォルダまで含めた URL を指定する（例 `https://nas.local:5006/home/kamilog`）。
Synology は HTTPS の既定ポートが 5006。自己署名証明書のまま使う場合は verify_tls=False にする。
"""

import xml.etree.ElementTree as ET
from urllib.parse import quote, unquote, urlsplit

import httpx

from app.services.storage_backends.base import (
    ObjectStore, StorageAuthError, StorageError, StorageNotFound, join_prefix,
)

_PROPFIND_BODY = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
)
_NS = {"d": "DAV:"}


class WebDAVStore(ObjectStore):
    def __init__(
        self,
        url: str,
        username: str,
        password: str,
        prefix: str = "",
        verify_tls: bool = True,
        transport: httpx.BaseTransport | None = None,
    ):
        self._base = url.rstrip("/")
        self._base_path = unquote(urlsplit(self._base).path).rstrip("/")
        self._prefix = prefix
        self._client = httpx.Client(
            auth=(username, password), verify=verify_tls, timeout=60.0, transport=transport
        )
        self._made_dirs: set[str] = set()  # MKCOL 済みのフォルダ（同じプロセス内で繰り返さない）

    def _path(self, key: str) -> str:
        return join_prefix(self._prefix, key)

    def _url(self, path: str) -> str:
        return f"{self._base}/{quote(path)}"

    @staticmethod
    def _check(resp: httpx.Response, ok: tuple[int, ...]) -> None:
        if resp.status_code in ok:
            return
        if resp.status_code == 404:
            raise StorageNotFound(resp.request.url.path)
        if resp.status_code in (401, 403):
            raise StorageAuthError(f"WebDAV の認証に失敗しました (HTTP {resp.status_code})")
        raise StorageError(f"WebDAV の操作に失敗しました (HTTP {resp.status_code})")

    def _request(self, method: str, url: str, **kw) -> httpx.Response:
        try:
            return self._client.request(method, url, **kw)
        except httpx.HTTPError as exc:
            raise StorageError(f"WebDAV サーバーに接続できません: {exc}") from exc

    def _ensure_dirs(self, path: str) -> None:
        parts = path.split("/")[:-1]
        current = ""
        for part in parts:
            current = f"{current}/{part}" if current else part
            if current in self._made_dirs:
                continue
            resp = self._request("MKCOL", self._url(current) + "/")
            # 201: 作成, 405: 既にある, 301: 末尾スラッシュへのリダイレクト（既にある）
            self._check(resp, (200, 201, 301, 405))
            self._made_dirs.add(current)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        self._ensure_dirs(path)
        resp = self._request(
            "PUT", self._url(path), content=data, headers={"Content-Type": content_type}
        )
        self._check(resp, (200, 201, 204))

    def get(self, key: str) -> bytes:
        resp = self._request("GET", self._url(self._path(key)))
        self._check(resp, (200,))
        return resp.content

    def delete(self, key: str) -> None:
        resp = self._request("DELETE", self._url(self._path(key)))
        if resp.status_code != 404:
            self._check(resp, (200, 202, 204))

    def _propfind(self, dir_path: str) -> list[tuple[str, bool]]:
        """フォルダ直下の (base 以降の相対パス, フォルダか) の一覧。"""
        resp = self._request(
            "PROPFIND",
            self._url(dir_path) + "/",
            content=_PROPFIND_BODY,
            headers={"Depth": "1", "Content-Type": "application/xml"},
        )
        if resp.status_code == 404:
            return []
        self._check(resp, (207,))
        out = []
        for r in ET.fromstring(resp.content).findall("d:response", _NS):
            href = r.findtext("d:href", default="", namespaces=_NS)
            path = unquote(urlsplit(href).path).rstrip("/")
            if not path.startswith(self._base_path + "/"):
                continue
            rel = path[len(self._base_path) + 1:]
            if rel == dir_path.rstrip("/"):
                continue  # フォルダ自身
            is_dir = r.find(".//d:resourcetype/d:collection", _NS) is not None
            out.append((rel, is_dir))
        return out

    def list(self, prefix: str) -> list[str]:
        """prefix をフォルダとみなして配下を再帰的にたどる（Depth: infinity は無効な NAS が多い）。"""
        root = self._path(prefix).rstrip("/")
        strip = len(self._path(""))
        keys: list[str] = []
        pending = [root]
        while pending:
            current = pending.pop()
            for rel, is_dir in self._propfind(current):
                if is_dir:
                    pending.append(rel)
                else:
                    keys.append(rel[strip:])
        return keys
