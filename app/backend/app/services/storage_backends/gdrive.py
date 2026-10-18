"""Google ドライブの保存先（OAuth で連携した利用者自身のドライブ）。

スコープは `drive.file`（このアプリが作ったファイルにしか触れない）。ドライブはパスでなく
ID でファイルを扱うため、各ファイルの appProperties `dms_key` に保存キーを入れて検索する。
フォルダ構成は「紙ログ/{doc_id}/pages/000」のように、書類ごとのフォルダの中にキーの残りを
ファイル名として置く（ドライブ上で見ても書類単位にまとまるように）。
"""

import base64
import json
import threading
import time
import uuid
from collections import OrderedDict
from urllib.parse import urlencode

import httpx

from app.services.storage_backends.base import (
    ObjectStore, StorageAuthError, StorageError, StorageNotFound, join_prefix,
)

# drive.file: このアプリが作ったファイルだけ。openid email: 連携したアカウントを画面に表示するため
SCOPE = "openid email https://www.googleapis.com/auth/drive.file"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
FOLDER_MIME = "application/vnd.google-apps.folder"
ROOT_FOLDER_NAME = "紙ログ"

_KEY_PROP = "dms_key"
_ID_CACHE_SIZE = 2048


# ---- OAuth（連携時に1回だけ使う） ----


def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    return AUTH_URL + "?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",  # 再連携でも refresh_token を必ず受け取る
        "include_granted_scopes": "true",
        "state": state,
    })


def exchange_code(
    client_id: str, client_secret: str, redirect_uri: str, code: str,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """認可コードをトークンに交換する。戻り値は Google のトークンレスポンス。"""
    with httpx.Client(timeout=30.0, transport=transport) as client:
        resp = client.post(TOKEN_URL, data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
    if resp.status_code != 200:
        raise StorageAuthError(f"Google の認可コードを交換できませんでした (HTTP {resp.status_code})")
    data = resp.json()
    if not data.get("refresh_token"):
        raise StorageAuthError("Google からリフレッシュトークンを受け取れませんでした。もう一度連携してください")
    return data


def id_token_email(token_response: dict) -> str | None:
    """トークンレスポンスの id_token から連携したアカウントのメールを取り出す（表示用）。

    Google のトークンエンドポイントから TLS で直接受け取った値なので署名検証は省略する。
    """
    raw = token_response.get("id_token")
    if not raw:
        return None
    try:
        payload = raw.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("email")
    except (IndexError, ValueError):
        return None


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


class GoogleDriveStore(ObjectStore):
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        folder_id: str | None,
        prefix: str = "",
        transport: httpx.BaseTransport | None = None,
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self.folder_id = folder_id
        self._prefix = prefix
        self._http = httpx.Client(timeout=60.0, transport=transport)
        self._lock = threading.Lock()        # トークン更新用
        self._cache_lock = threading.Lock()  # ID キャッシュ用（API はスレッドプールから並行に呼ばれる）
        self._token: str | None = None
        self._token_expires = 0.0
        self._ids: OrderedDict[str, str] = OrderedDict()   # 保存キー → fileId
        self._folders: dict[str, str] = {}                  # 書類フォルダ名 → folderId

    # ---- 認証 ----

    def _access_token(self, force: bool = False) -> str:
        with self._lock:
            if not force and self._token and time.time() < self._token_expires - 60:
                return self._token
            try:
                resp = self._http.post(TOKEN_URL, data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token,
                    "grant_type": "refresh_token",
                })
            except httpx.HTTPError as exc:
                raise StorageError(f"Google に接続できません: {exc}") from exc
            if resp.status_code in (400, 401):
                # invalid_grant: 連携の解除・パスワード変更・長期間未使用など
                raise StorageAuthError("Google ドライブとの連携が切れています。再連携してください")
            if resp.status_code != 200:
                raise StorageError(f"Google のトークン更新に失敗しました (HTTP {resp.status_code})")
            data = resp.json()
            self._token = data["access_token"]
            self._token_expires = time.time() + int(data.get("expires_in", 3600))
            return self._token

    def _request(self, method: str, url: str, headers: dict | None = None, **kw) -> httpx.Response:
        """アクセストークンを付けて呼ぶ。401 ならトークンを更新して1回だけやり直す。"""
        for attempt in (0, 1):
            auth = {"Authorization": f"Bearer {self._access_token(force=attempt == 1)}"}
            try:
                resp = self._http.request(method, url, headers={**(headers or {}), **auth}, **kw)
            except httpx.HTTPError as exc:
                raise StorageError(f"Google ドライブに接続できません: {exc}") from exc
            if resp.status_code != 401:
                break
        if resp.status_code == 401:
            raise StorageAuthError("Google ドライブの認証に失敗しました。再連携してください")
        if resp.status_code == 403:
            raise StorageError(f"Google ドライブに拒否されました (HTTP 403): {resp.text[:200]}")
        return resp

    @staticmethod
    def _check(resp: httpx.Response, what: str) -> None:
        if resp.status_code == 404:
            raise StorageNotFound(what)
        if resp.status_code >= 300:
            raise StorageError(f"Google ドライブの{what}に失敗しました (HTTP {resp.status_code})")

    # ---- フォルダ・ファイル ID ----

    def create_root_folder(self) -> str:
        """連携直後に「紙ログ」フォルダを作る。"""
        resp = self._request("POST", f"{API}/files", params={"fields": "id"}, json={
            "name": ROOT_FOLDER_NAME, "mimeType": FOLDER_MIME,
        })
        self._check(resp, "フォルダ作成")
        self.folder_id = resp.json()["id"]
        return self.folder_id

    def _search(self, q: str, fields: str = "files(id)") -> list[dict]:
        files: list[dict] = []
        page_token = None
        while True:
            params = {"q": q, "fields": f"nextPageToken,{fields}", "pageSize": 1000, "spaces": "drive"}
            if page_token:
                params["pageToken"] = page_token
            resp = self._request("GET", f"{API}/files", params=params)
            self._check(resp, "検索")
            data = resp.json()
            files.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                return files

    def _folder_for(self, name: str, create: bool) -> str | None:
        if name in self._folders:
            return self._folders[name]
        if not self.folder_id:
            raise StorageError("Google ドライブの保存フォルダが未設定です。再連携してください")
        hits = self._search(
            f"name = '{_escape(name)}' and '{self.folder_id}' in parents "
            f"and mimeType = '{FOLDER_MIME}' and trashed = false"
        )
        if hits:
            self._folders[name] = hits[0]["id"]
        elif create:
            resp = self._request("POST", f"{API}/files", params={"fields": "id"}, json={
                "name": name, "mimeType": FOLDER_MIME, "parents": [self.folder_id],
            })
            self._check(resp, "フォルダ作成")
            self._folders[name] = resp.json()["id"]
        else:
            return None
        return self._folders[name]

    def _remember(self, full_key: str, file_id: str | None) -> None:
        with self._cache_lock:
            if file_id is None:
                self._ids.pop(full_key, None)
                return
            self._ids[full_key] = file_id
            self._ids.move_to_end(full_key)
            while len(self._ids) > _ID_CACHE_SIZE:
                self._ids.popitem(last=False)

    def _find(self, full_key: str) -> str | None:
        with self._cache_lock:
            if full_key in self._ids:
                self._ids.move_to_end(full_key)
                return self._ids[full_key]
        hits = self._search(
            f"appProperties has {{ key='{_KEY_PROP}' and value='{_escape(full_key)}' }} "
            "and trashed = false"
        )
        file_id = hits[0]["id"] if hits else None
        if file_id:
            self._remember(full_key, file_id)
        return file_id

    # ---- ObjectStore ----

    def put(self, key: str, data: bytes, content_type: str) -> None:
        full = join_prefix(self._prefix, key)
        file_id = self._find(full)
        if file_id:
            resp = self._request(
                "PATCH", f"{UPLOAD_API}/files/{file_id}",
                params={"uploadType": "media", "fields": "id"},
                content=data, headers={"Content-Type": content_type},
            )
            if resp.status_code != 404:
                self._check(resp, "上書き保存")
                return
            self._remember(full, None)  # ドライブ上で消されていたら作り直す

        # 書類フォルダ名は接頭辞を除いたキーの先頭（= doc_id）
        folder_name, _, rest = key.partition("/")
        if not rest:
            folder_name, rest = "_", key
        parent = self._folder_for(folder_name, create=True)
        boundary = uuid.uuid4().hex
        meta = {"name": rest, "parents": [parent], "appProperties": {_KEY_PROP: full}}
        body = (
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{json.dumps(meta, ensure_ascii=False)}\r\n"
            f"--{boundary}\r\nContent-Type: {content_type}\r\n\r\n"
        ).encode() + data + f"\r\n--{boundary}--".encode()
        resp = self._request(
            "POST", f"{UPLOAD_API}/files",
            params={"uploadType": "multipart", "fields": "id"},
            content=body, headers={"Content-Type": f"multipart/related; boundary={boundary}"},
        )
        self._check(resp, "保存")
        self._remember(full, resp.json()["id"])

    def get(self, key: str) -> bytes:
        full = join_prefix(self._prefix, key)
        file_id = self._find(full)
        if not file_id:
            raise StorageNotFound(full)
        resp = self._request("GET", f"{API}/files/{file_id}", params={"alt": "media"})
        if resp.status_code == 404:
            self._remember(full, None)
        self._check(resp, "読み出し")
        return resp.content

    def delete(self, key: str) -> None:
        full = join_prefix(self._prefix, key)
        file_id = self._find(full)
        if not file_id:
            return
        resp = self._request("DELETE", f"{API}/files/{file_id}")
        self._remember(full, None)
        if resp.status_code != 404:
            self._check(resp, "削除")

    def list(self, prefix: str) -> list[str]:
        """prefix の先頭（書類フォルダ）配下のファイルから、保存キーが prefix で始まるものを返す。"""
        full = join_prefix(self._prefix, prefix)
        folder_name = prefix.split("/", 1)[0]
        folder = self._folder_for(folder_name, create=False)
        if folder is None:
            return []
        strip = len(join_prefix(self._prefix, ""))
        files = self._search(
            f"'{folder}' in parents and trashed = false", fields="files(id,appProperties)"
        )
        keys = []
        for f in files:
            k = (f.get("appProperties") or {}).get(_KEY_PROP, "")
            if k.startswith(full):
                self._remember(k, f["id"])
                keys.append(k[strip:])
        return keys
