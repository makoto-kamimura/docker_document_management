"""SSO（OpenID Connect）: ID トークンの確認、PKCE、戻り先、連携とログイン、「SSO だけ」。

認証サーバーは偽物（httpx.get / httpx.post を差し替え）。本物の RSA・Ed25519・EC の鍵で署名する。
"""

import base64
import hashlib
import json
import time
import uuid
from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.hazmat.primitives import hashes, hmac as chmac
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import app
from app.models.tenant import Tenant
from app.models.user import Role, User
from app.services import oidc

ISSUER = "https://auth.test/auth/v1"
CLIENT_ID = "document"


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _int(n: int) -> str:
    return b64(n.to_bytes((n.bit_length() + 7) // 8, "big"))


class Signer:
    def __init__(self, kind: str, kid: str):
        self.kind, self.kid = kind, kid
        if kind == "RS256":
            self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            pub = self.key.public_key().public_numbers()
            self.jwk = {"kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig", "n": _int(pub.n), "e": _int(pub.e)}
        elif kind == "EdDSA":
            self.key = ed25519.Ed25519PrivateKey.generate()
            from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
            raw = self.key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
            self.jwk = {"kty": "OKP", "crv": "Ed25519", "kid": kid, "alg": "EdDSA", "x": b64(raw)}
        else:  # ES256
            self.key = ec.generate_private_key(ec.SECP256R1())
            pub = self.key.public_key().public_numbers()
            self.jwk = {"kty": "EC", "crv": "P-256", "kid": kid, "alg": "ES256",
                        "x": b64(pub.x.to_bytes(32, "big")), "y": b64(pub.y.to_bytes(32, "big"))}

    def sign(self, claims: dict, alg: str | None = None, kid: str | None = None) -> str:
        head = b64(json.dumps({"alg": alg or self.kind, "kid": kid or self.kid, "typ": "JWT"}).encode())
        body = b64(json.dumps(claims).encode())
        data = f"{head}.{body}".encode()
        if self.kind == "RS256":
            sig = self.key.sign(data, padding.PKCS1v15(), hashes.SHA256())
        elif self.kind == "EdDSA":
            sig = self.key.sign(data)
        else:
            r, s = decode_dss_signature(self.key.sign(data, ec.ECDSA(hashes.SHA256())))
            sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
        return f"{head}.{body}.{b64(sig)}"


RSA = Signer("RS256", "rsa-1")
ED = Signer("EdDSA", "ed-1")
EC = Signer("ES256", "ec-1")


def claims(**over) -> dict:
    now = int(time.time())
    c = {"iss": ISSUER, "aud": CLIENT_ID, "sub": "sub-1", "exp": now + 300, "iat": now,
         "nonce": "n0nce", "amr": ["pwd", "mfa"], "email": "me@family.test"}
    c.update(over)
    return {k: v for k, v in c.items() if v is not None}


KEYS = oidc.parse_jwks({"keys": [RSA.jwk, ED.jwk, EC.jwk]})


def verify(token: str, require_mfa: bool = True) -> dict:
    return oidc.verify_id_token(token, KEYS, ISSUER, CLIENT_ID, "n0nce", require_mfa)


def rejected(token: str, require_mfa: bool = True) -> str:
    with pytest.raises(oidc.Rejected) as e:
        verify(token, require_mfa)
    return e.value.reason


# ---- 単体: ID トークン --------------------------------------------------------


def test_valid_tokens_for_each_algorithm():
    for s in (RSA, ED, EC):
        assert verify(s.sign(claims()))["sub"] == "sub-1"


def test_rejects_bad_tokens():
    other = Signer("RS256", "rsa-1")  # 同じ kid の別の鍵
    assert rejected(other.sign(claims())) == "signature"
    head, body, sig = RSA.sign(claims()).split(".")
    tampered = b64(json.dumps(claims(sub="someone-else")).encode())
    assert rejected(f"{head}.{tampered}.{sig}") == "signature"
    # HS256（公開鍵を共通鍵として使わせる攻撃）と none
    h = b64(json.dumps({"alg": "HS256", "kid": "rsa-1"}).encode())
    b = b64(json.dumps(claims()).encode())
    mac = chmac.HMAC(json.dumps(RSA.jwk).encode(), hashes.SHA256())
    mac.update(f"{h}.{b}".encode())
    assert rejected(f"{h}.{b}.{b64(mac.finalize())}") == "alg"
    n = b64(json.dumps({"alg": "none", "kid": "rsa-1"}).encode())
    assert rejected(f"{n}.{b}.") == "alg"
    # 鍵の方式と違う方式を名乗る
    assert rejected(RSA.sign(claims(), alg="PS256")) == "alg_mismatch"
    assert rejected(RSA.sign(claims(), kid="nope")) == "unknown_kid"
    assert rejected(RSA.sign(claims(iss="https://evil.test/auth/v1"))) == "iss"
    assert rejected(RSA.sign(claims(aud="other"))) == "aud"
    assert rejected(RSA.sign(claims(aud=[CLIENT_ID, "other"]))) == "azp"
    assert verify(RSA.sign(claims(aud=[CLIENT_ID, "other"], azp=CLIENT_ID)))["sub"] == "sub-1"
    assert rejected(RSA.sign(claims(exp=int(time.time()) - 120))) == "exp"
    assert rejected(RSA.sign(claims(exp=None))) == "exp"
    assert rejected(RSA.sign(claims(nonce="other"))) == "nonce"
    assert rejected(RSA.sign(claims(sub=""))) == "sub"
    assert rejected(RSA.sign(claims(amr=["pwd"]))) == "mfa_required"
    assert verify(RSA.sign(claims(amr=["pwd"])), require_mfa=False)["sub"] == "sub-1"
    assert rejected("not.a.jwt") == "header"


def test_pkce_and_redirects():
    # RFC 7636 の付録 B の例
    assert oidc.pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == \
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    assert oidc.verify_pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    assert not oidc.verify_pkce("short", oidc.pkce_challenge("short"))
    prefixes = ["dms://", "exp://"]
    assert oidc.mobile_redirect_allowed("dms://auth/sso", prefixes)
    assert oidc.mobile_redirect_allowed("exp://192.168.0.2:8081/--/auth/sso", prefixes)
    for bad in ("https://evil.test/", "http://x/", "evil://auth/sso", "dms://auth/sso#x", ""):
        assert not oidc.mobile_redirect_allowed(bad, prefixes)
    assert oidc.link_denied("demo@example.com", ["example.com"])
    assert oidc.link_denied("no-at-mark", ["example.com"])
    assert not oidc.link_denied("me@family.test", ["example.com"])


# ---- 結合: 偽の認証サーバー ----------------------------------------------------


class FakeIdp:
    """設定の公開・JWKS・トークンを返す。トークンの交換では認可コードと PKCE を確かめる"""

    def __init__(self):
        self.codes: dict[str, dict] = {}
        self.signer = RSA
        self.jwks_hits = 0

    def authorize(self, url: str, sub: str = "sub-1", amr=("pwd", "mfa")) -> str:
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        assert q["client_id"] == CLIENT_ID and q["code_challenge_method"] == "S256"
        code = uuid.uuid4().hex
        self.codes[code] = {"q": q, "sub": sub, "amr": list(amr)}
        return f"{q['redirect_uri']}?code={code}&state={q['state']}"

    def get(self, url, **kw):
        if url.endswith("/.well-known/openid-configuration"):
            return Resp(200, {"issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/oidc/authorize",
                              "token_endpoint": f"{ISSUER}/oidc/token", "jwks_uri": f"{ISSUER}/oidc/certs"})
        if url.endswith("/oidc/certs"):
            self.jwks_hits += 1
            return Resp(200, {"keys": [self.signer.jwk]})
        return Resp(404, {})

    def post(self, url, data=None, **kw):
        entry = self.codes.pop(data["code"], None)
        if entry is None or data["client_secret"] != "s3cret":
            return Resp(400, {"error": "invalid_grant"})
        q = entry["q"]
        challenge = b64(hashlib.sha256(data["code_verifier"].encode()).digest())
        if challenge != q["code_challenge"] or data["redirect_uri"] != q["redirect_uri"]:
            return Resp(400, {"error": "invalid_grant"})
        token = self.signer.sign(claims(sub=entry["sub"], nonce=q["nonce"], amr=entry["amr"]))
        return Resp(200, {"id_token": token, "access_token": "x", "token_type": "Bearer"})


class Resp:
    def __init__(self, status: int, body: dict):
        self.status_code, self._body = status, body
        self.text = json.dumps(body)

    def json(self):
        return self._body


@pytest.fixture
def idp(monkeypatch):
    fake = FakeIdp()
    monkeypatch.setattr(oidc.httpx, "get", fake.get)
    monkeypatch.setattr(oidc.httpx, "post", fake.post)
    for k, v in {"oidc_issuer": ISSUER, "oidc_client_id": CLIENT_ID, "oidc_client_secret": "s3cret",
                 "public_base_url": "https://document.test", "oidc_require_mfa": True,
                 "oidc_allow_password_for_sso_only": False}.items():
        monkeypatch.setattr(settings, k, v)
    oidc.reset_cache()
    yield fake
    oidc.reset_cache()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def people(db):
    tenant = Tenant(slug="f", name="F家")
    db.add(tenant)
    db.commit()
    me = User(email="me@family.test", name="わたし", role=Role.admin,
              hashed_password=hash_password("pw-1234"), tenant_id=tenant.id)
    other = User(email="you@family.test", name="あなた", role=Role.viewer,
                 hashed_password=hash_password("pw-5678"), tenant_id=tenant.id)
    demo = User(email="demo@example.com", name="デモ", role=Role.viewer,
                hashed_password=hash_password("demo123"), tenant_id=tenant.id)
    db.add_all([me, other, demo])
    db.commit()
    return me, other, demo


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def pwd_login(client, email, password):
    return client.post("/api/v1/auth/login", data={"username": email, "password": password})


def run_flow(client, idp, mode, token=None, sub="sub-1", amr=("pwd", "mfa"), verifier=None):
    """Web の流れを通し、交換の応答（または戻り先の error）を返す"""
    verifier = verifier or b64(uuid.uuid4().bytes * 2)
    params = {"mode": mode, "client": "web", "code_challenge": oidc.pkce_challenge(verifier)}
    if mode == "link":
        params["intent"] = client.post("/api/v1/me/identities/sso/intent", headers=bearer(token)).json()["intent"]
    res = client.get("/api/v1/auth/sso/start", params=params, follow_redirects=False)
    assert res.status_code == 303, res.text
    back = idp.authorize(res.headers["location"], sub=sub, amr=amr)
    res = client.get(urlsplit(back).path + "?" + urlsplit(back).query, follow_redirects=False)
    assert res.status_code == 303
    loc = res.headers["location"]
    assert loc.startswith("https://document.test/auth/sso/complete?")
    q = {k: v[0] for k, v in parse_qs(urlsplit(loc).query).items()}
    if "error" in q:
        return q["error"]
    return client.post("/api/v1/auth/sso/exchange", json={"code": q["code"], "code_verifier": verifier},
                       headers=bearer(token) if token else {})


def test_providers_disabled_without_config(client, monkeypatch):
    monkeypatch.setattr(settings, "oidc_client_secret", "")
    assert client.get("/api/v1/auth/providers").json() == {"sso": False, "sso_name": None}
    assert client.get("/api/v1/auth/sso/start", params={"mode": "login"}).status_code == 404


def test_link_then_login_then_sso_only(client, idp, people):
    me, _, _ = people
    # 連携していなければ SSO では入れない
    assert run_flow(client, idp, "login") == "not_linked"

    pwd = pwd_login(client, "me@family.test", "pw-1234").json()["access_token"]
    ids = client.get("/api/v1/me/identities", headers=bearer(pwd)).json()
    assert ids["sso_enabled"] and ids["can_link"] and ids["identities"] == [] and ids["login_method"] == "pwd"
    res = run_flow(client, idp, "link", token=pwd)
    assert res.status_code == 200 and res.json() == {"mode": "link", "email": "me@family.test"}

    res = run_flow(client, idp, "login")
    assert res.status_code == 200 and res.json()["mode"] == "login"
    sso = res.json()["access_token"]
    me_res = client.get("/api/v1/auth/me", headers=bearer(sso))
    assert me_res.status_code == 200 and me_res.json()["email"] == "me@family.test"

    # 「SSO だけ」はパスワードのログインではオンにできない
    assert client.put("/api/v1/me/sso-only", json={"enabled": True}, headers=bearer(pwd)).status_code == 400
    assert client.put("/api/v1/me/sso-only", json={"enabled": True}, headers=bearer(sso)).json() == {"sso_only": True}
    # パスワードのトークンは、ほかの端末のものもその時点から 401。パスワードのログインは 403（違えば 401）
    assert client.get("/api/v1/auth/me", headers=bearer(pwd)).status_code == 401
    assert pwd_login(client, "me@family.test", "pw-1234").status_code == 403
    assert pwd_login(client, "me@family.test", "wrong").status_code == 401
    assert client.get("/api/v1/auth/me", headers=bearer(sso)).status_code == 200
    # 以前のトークン（amr なし）もパスワード扱い
    from jose import jwt
    legacy = jwt.encode({"sub": str(me.id), "role": "admin", "exp": int(time.time()) + 600},
                        settings.jwt_secret, algorithm=settings.jwt_algorithm)
    assert client.get("/api/v1/auth/me", headers=bearer(legacy)).status_code == 401

    # 非常用の切り替え
    settings.oidc_allow_password_for_sso_only = True
    try:
        assert pwd_login(client, "me@family.test", "pw-1234").status_code == 200
    finally:
        settings.oidc_allow_password_for_sso_only = False

    # 解除すると「SSO だけ」も外れ、SSO では入れなくなる
    assert client.delete("/api/v1/me/identities/sso", headers=bearer(sso)).json() == {"unlinked": True}
    assert pwd_login(client, "me@family.test", "pw-1234").status_code == 200
    assert run_flow(client, idp, "login") == "not_linked"


def test_exchange_is_single_use_and_needs_the_verifier(client, idp, people, db):
    pwd = pwd_login(client, "me@family.test", "pw-1234").json()["access_token"]
    assert run_flow(client, idp, "link", token=pwd).status_code == 200

    verifier = b64(uuid.uuid4().bytes * 2)
    res = client.get("/api/v1/auth/sso/start", follow_redirects=False, params={
        "mode": "login", "client": "web", "code_challenge": oidc.pkce_challenge(verifier)})
    back = idp.authorize(res.headers["location"])
    loc = client.get(urlsplit(back).path + "?" + urlsplit(back).query, follow_redirects=False).headers["location"]
    code = parse_qs(urlsplit(loc).query)["code"][0]
    # 違う code_verifier → 401。結果コードはその時点で消える
    wrong = b64(uuid.uuid4().bytes * 2)
    assert client.post("/api/v1/auth/sso/exchange", json={"code": code, "code_verifier": wrong}).status_code == 401
    assert client.post("/api/v1/auth/sso/exchange", json={"code": code, "code_verifier": verifier}).status_code == 401
    # state の再利用は 400
    assert client.get(urlsplit(back).path + "?" + urlsplit(back).query, follow_redirects=False).status_code == 400


def test_link_guards(client, idp, people):
    me, other, demo = people
    # デモ用アカウントは連携できない
    demo_tok = pwd_login(client, "demo@example.com", "demo123").json()["access_token"]
    assert client.get("/api/v1/me/identities", headers=bearer(demo_tok)).json()["can_link"] is False
    assert client.post("/api/v1/me/identities/sso/intent", headers=bearer(demo_tok)).status_code == 400

    mine = pwd_login(client, "me@family.test", "pw-1234").json()["access_token"]
    theirs = pwd_login(client, "you@family.test", "pw-5678").json()["access_token"]
    # 他人の intent で始めた連携を、自分のトークンで交換しても通らない
    verifier = b64(uuid.uuid4().bytes * 2)
    intent = client.post("/api/v1/me/identities/sso/intent", headers=bearer(theirs)).json()["intent"]
    res = client.get("/api/v1/auth/sso/start", follow_redirects=False, params={
        "mode": "link", "client": "web", "code_challenge": oidc.pkce_challenge(verifier), "intent": intent})
    back = idp.authorize(res.headers["location"])
    loc = client.get(urlsplit(back).path + "?" + urlsplit(back).query, follow_redirects=False).headers["location"]
    code = parse_qs(urlsplit(loc).query)["code"][0]
    assert client.post("/api/v1/auth/sso/exchange", json={"code": code, "code_verifier": verifier},
                       headers=bearer(mine)).status_code == 403
    # intent は 1 回だけ
    res = client.get("/api/v1/auth/sso/start", follow_redirects=False, params={
        "mode": "link", "client": "web", "code_challenge": oidc.pkce_challenge(verifier), "intent": intent})
    assert "error=expired" in res.headers["location"]

    # 1 つの SSO のアカウントは 1 人だけ
    assert run_flow(client, idp, "link", token=mine).status_code == 200
    assert run_flow(client, idp, "link", token=theirs).status_code == 409
    # 2 つ目の SSO のアカウントは、解除してから
    assert run_flow(client, idp, "link", token=mine, sub="sub-2").status_code == 409


def test_mfa_cancel_and_redirect_checks(client, idp, people):
    mine = pwd_login(client, "me@family.test", "pw-1234").json()["access_token"]
    assert run_flow(client, idp, "link", token=mine).status_code == 200
    assert run_flow(client, idp, "login", amr=("pwd",)) == "mfa_required"

    verifier = b64(uuid.uuid4().bytes * 2)
    res = client.get("/api/v1/auth/sso/start", follow_redirects=False, params={
        "mode": "login", "client": "web", "code_challenge": oidc.pkce_challenge(verifier)})
    state = parse_qs(urlsplit(res.headers["location"]).query)["state"][0]
    res = client.get("/api/v1/auth/sso/callback", params={"error": "access_denied", "state": state},
                     follow_redirects=False)
    assert res.headers["location"].endswith("error=cancelled")

    for bad in ("https://evil.test/cb", "evil://x"):
        res = client.get("/api/v1/auth/sso/start", params={
            "mode": "login", "client": "mobile", "code_challenge": oidc.pkce_challenge(verifier), "redirect_uri": bad})
        assert res.status_code == 400
    res = client.get("/api/v1/auth/sso/start", follow_redirects=False, params={
        "mode": "login", "client": "mobile", "code_challenge": oidc.pkce_challenge(verifier),
        "redirect_uri": "exp://192.168.0.2:8081/--/auth/sso"})
    assert res.status_code == 303


def test_key_rotation(client, idp, people, monkeypatch):
    mine = pwd_login(client, "me@family.test", "pw-1234").json()["access_token"]
    assert run_flow(client, idp, "link", token=mine).status_code == 200
    # 鍵が入れ替わった直後でも、知らない kid なら読み直して通る
    idp.signer = ED
    oidc_time = time.time()
    monkeypatch.setattr(oidc.time, "time", lambda: oidc_time + oidc.JWKS_FORCE_REFRESH_MIN + 1)
    res = run_flow(client, idp, "login")
    assert res.status_code == 200
    assert idp.jwks_hits == 2


def test_token_without_method_is_password(people):
    me, _, _ = people
    token = create_access_token(str(me.id), "admin")
    from app.core.security import decode_token, login_method
    assert login_method(decode_token(token)) == "pwd"
    assert login_method(decode_token(create_access_token(str(me.id), "admin", method="sso"))) == "sso"
