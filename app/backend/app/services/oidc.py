"""SSO（OpenID Connect）のクライアント。接続先は設定の発行元（OIDC_ISSUER）だけで決まり、
エンドポイントと公開鍵は /.well-known/openid-configuration から読む。

乗っ取りを防ぐ要（docker_auth_server の docs/runbooks/app-integration.md の 2.2）:
- ID トークンは公開鍵（JWKS）で署名を確かめ、iss・aud・exp・nonce も確かめる
- 利用者の特定には sub だけを使う
- 戻ったあとは使い捨ての結果コードを返し、開始したクライアントの code_verifier と引き換える

署名の確認は python-jose を使わず cryptography で直接行う（許す方式を明示し、鍵の種類と方式の
取り違えを起こさないため）。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from dataclasses import dataclass
from urllib.parse import quote, urlencode, urlsplit

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app.core.config import settings

PROVIDER = "sso"

CACHE_TTL = 3600             # 設定の公開と公開鍵を読み直す間隔（秒）
JWKS_FORCE_REFRESH_MIN = 10  # 知らない kid のときに公開鍵を読み直してよい最短の間隔（秒）
LEEWAY = 60                  # 時計のずれの許容（秒）

_HASHES = {"256": hashes.SHA256, "384": hashes.SHA384, "512": hashes.SHA512}
# ID トークンの署名に許す方式。共通鍵（HS*）と none は許さない
ALLOWED_ALGS = ("RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "EdDSA")


class Rejected(Exception):
    """ID トークンを受け付けない理由。reason はログと分岐に使う（mfa_required だけ画面に返す）。"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------


def _list(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def enabled() -> bool:
    return all(
        v.strip()
        for v in (
            settings.oidc_issuer, settings.oidc_client_id, settings.oidc_client_secret,
            settings.public_base_url,
        )
    )


def display_name() -> str:
    return settings.oidc_display_name.strip() or "SSO"


def _base_url() -> str:
    return settings.public_base_url.strip().rstrip("/")


def callback_url() -> str:
    return f"{_base_url()}{settings.api_v1_prefix}/auth/sso/callback"


def web_return_url() -> str:
    return f"{_base_url()}/auth/sso/complete"


def mobile_redirect_prefixes() -> list[str]:
    return _list(settings.oidc_mobile_redirect_prefixes)


def link_deny_domains() -> list[str]:
    return [d.lower() for d in _list(settings.oidc_link_deny_email_domains)]


def login_method_allowed(user, method: str) -> bool:
    """このログイン方法（pwd / sso）を、この利用者に許すか（「SSO だけ」の判定）。

    SSO が無効な環境と、非常用の切り替え（OIDC_ALLOW_PASSWORD_FOR_SSO_ONLY）では、パスワードも許す。
    """
    if method == "sso" or not getattr(user, "sso_only", False):
        return True
    return not enabled() or settings.oidc_allow_password_for_sso_only


# ---------------------------------------------------------------------------
# 乱数・PKCE・戻り先
# ---------------------------------------------------------------------------


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(s: str) -> bytes:
    if not isinstance(s, str) or not re.fullmatch(r"[A-Za-z0-9_-]*", s):
        raise ValueError("not base64url")
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def random_token() -> str:
    """推測できない 32 バイトの乱数（base64url、43 文字）"""
    return b64url(secrets.token_bytes(32))


def hash_token(token: str) -> str:
    """DB に保存するためのハッシュ。トークンそのものは保存しない"""
    return b64url(hashlib.sha256(token.encode()).digest())


def pkce_challenge(verifier: str) -> str:
    return b64url(hashlib.sha256(verifier.encode()).digest())


def is_valid_verifier(v: str) -> bool:
    return isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9\-._~]{43,128}", v) is not None


def is_valid_challenge(c: str) -> bool:
    return isinstance(c, str) and re.fullmatch(r"[A-Za-z0-9\-_]{43}", c) is not None


def verify_pkce(verifier: str, challenge: str) -> bool:
    return is_valid_verifier(verifier) and hmac.compare_digest(challenge or "", pkce_challenge(verifier))


def mobile_redirect_allowed(uri: str, prefixes: list[str]) -> bool:
    """モバイルの戻り先が許可リストの先頭に一致するか（http・https・フラグメント付きは拒否）"""
    if not isinstance(uri, str) or "#" in uri:
        return False
    scheme = urlsplit(uri).scheme.lower()
    if not scheme or scheme in ("http", "https"):
        return False
    return any(p and uri.startswith(p) for p in prefixes)


def with_query(base: str, key: str, value: str) -> str:
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{quote(key, safe='')}={quote(value, safe='')}"


def link_denied(email: str, deny_domains: list[str]) -> bool:
    """このメールアドレスの利用者に連携させないか（デモ用アカウント）"""
    email = (email or "").strip().lower()
    if "@" not in email:
        return True
    return email.rsplit("@", 1)[1] in deny_domains


# ---------------------------------------------------------------------------
# ID トークンの確認
# ---------------------------------------------------------------------------


@dataclass
class Jwk:
    kid: str
    kty: str
    alg: str | None
    key: object  # cryptography の公開鍵


def _int(b64: str) -> int:
    return int.from_bytes(b64url_decode(b64), "big")


def parse_jwks(jwks: dict) -> dict[str, Jwk]:
    """公開鍵の一覧（JWKS）から、読めた署名用の鍵だけを kid => Jwk にする（知らない種類の鍵は飛ばす）"""
    keys: dict[str, Jwk] = {}
    for jwk in (jwks or {}).get("keys", []) if isinstance(jwks, dict) else []:
        if not isinstance(jwk, dict) or not jwk.get("kid") or jwk.get("use", "sig") != "sig":
            continue
        kty = jwk.get("kty")
        try:
            if kty == "RSA":
                key = rsa.RSAPublicNumbers(_int(jwk["e"]), _int(jwk["n"])).public_key()
            elif kty == "EC" and jwk.get("crv") == "P-256":
                key = ec.EllipticCurvePublicNumbers(
                    _int(jwk["x"]), _int(jwk["y"]), ec.SECP256R1()
                ).public_key()
            elif kty == "OKP" and jwk.get("crv") == "Ed25519":
                key = ed25519.Ed25519PublicKey.from_public_bytes(b64url_decode(jwk["x"]))
            else:
                continue
        except Exception:  # noqa: BLE001 - 使えない鍵は飛ばす
            continue
        keys[str(jwk["kid"])] = Jwk(str(jwk["kid"]), kty, jwk.get("alg"), key)
    return keys


def _verify_signature(alg: str, jwk: Jwk, signing_input: bytes, sig: bytes) -> None:
    """方式と鍵の種類が合わなければ、署名を見る前に断る（RS 鍵で別の方式を名乗らせない）"""
    try:
        if alg.startswith("RS") and jwk.kty == "RSA":
            jwk.key.verify(sig, signing_input, padding.PKCS1v15(), _HASHES[alg[2:]]())
        elif alg.startswith("PS") and jwk.kty == "RSA":
            h = _HASHES[alg[2:]]()
            jwk.key.verify(
                sig, signing_input, padding.PSS(mgf=padding.MGF1(h), salt_length=h.digest_size), h
            )
        elif alg == "ES256" and jwk.kty == "EC":
            if len(sig) != 64:
                raise Rejected("signature")
            der = encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big"))
            jwk.key.verify(der, signing_input, ec.ECDSA(hashes.SHA256()))
        elif alg == "EdDSA" and jwk.kty == "OKP":
            jwk.key.verify(sig, signing_input)
        else:
            raise Rejected("alg_mismatch")
    except InvalidSignature:
        raise Rejected("signature") from None


def header(token: str) -> dict | None:
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 3:
        return None
    try:
        h = json.loads(b64url_decode(parts[0]))
    except Exception:  # noqa: BLE001
        return None
    return h if isinstance(h, dict) else None


def verify_id_token(
    token: str, keys: dict[str, Jwk], issuer: str, client_id: str, nonce: str, require_mfa: bool,
    now: float | None = None,
) -> dict:
    """ID トークンの署名と中身を確かめて claims を返す。受け付けないときは Rejected。"""
    h = header(token)
    if h is None:
        raise Rejected("header")
    alg = h.get("alg")
    if alg not in ALLOWED_ALGS:
        raise Rejected("alg")
    kid = h.get("kid")
    if not isinstance(kid, str) or not kid:
        raise Rejected("kid")
    jwk = keys.get(kid)
    if jwk is None:
        raise Rejected("unknown_kid")
    if jwk.alg is not None and jwk.alg != alg:
        raise Rejected("alg_mismatch")

    head, body, sig = token.split(".")
    try:
        signature = b64url_decode(sig)
    except ValueError:
        raise Rejected("signature") from None
    _verify_signature(alg, jwk, f"{head}.{body}".encode(), signature)
    try:
        claims = json.loads(b64url_decode(body))
    except Exception:  # noqa: BLE001
        raise Rejected("claims") from None
    if not isinstance(claims, dict):
        raise Rejected("claims")

    now = time.time() if now is None else now
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or isinstance(exp, bool) or exp + LEEWAY < now:
        raise Rejected("exp")
    nbf = claims.get("nbf")
    if isinstance(nbf, (int, float)) and nbf - LEEWAY > now:
        raise Rejected("nbf")
    iat = claims.get("iat")
    if isinstance(iat, (int, float)) and iat - LEEWAY > now:
        raise Rejected("iat")
    # 設定の公開に書かれた発行元と完全に一致すること
    if claims.get("iss") != issuer:
        raise Rejected("iss")
    aud = claims.get("aud")
    auds = aud if isinstance(aud, list) else [aud]
    if client_id not in auds:
        raise Rejected("aud")
    if len(auds) > 1 and claims.get("azp") != client_id:
        raise Rejected("azp")
    got_nonce = claims.get("nonce")
    if not isinstance(got_nonce, str) or not hmac.compare_digest(got_nonce, nonce):
        raise Rejected("nonce")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub or len(sub) > 255:
        raise Rejected("sub")
    amr = claims.get("amr")
    if require_mfa and not (isinstance(amr, list) and "mfa" in amr):
        raise Rejected("mfa_required")
    return claims


def same_issuer(a: str, b: str) -> bool:
    """末尾の / だけが違う発行元は同じとみなす（設定の書き方の揺れ）"""
    return a.rstrip("/") == b.rstrip("/")


# ---------------------------------------------------------------------------
# 認証サーバーとの通信（起動時には取りに行かない）。キャッシュはプロセスごと
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_cache: dict[str, tuple[float, object]] = {}


def reset_cache() -> None:
    with _lock:
        _cache.clear()


def _get_json(url: str) -> dict:
    res = httpx.get(url, timeout=10, follow_redirects=False, headers={"Accept": "application/json"})
    if res.status_code != 200:
        raise RuntimeError(f"GET {url} returned {res.status_code}")
    data = res.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"GET {url}: not a JSON object")
    return data


def _origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme.lower()}://{(p.netloc or '').lower()}"


def metadata() -> dict:
    """設定の公開を読む。発行元が設定と違う、エンドポイントが発行元と別のオリジン、なら使わない"""
    with _lock:
        hit = _cache.get("metadata")
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]  # type: ignore[return-value]
    issuer = settings.oidc_issuer.strip()
    meta = _get_json(issuer.rstrip("/") + "/.well-known/openid-configuration")
    for k in ("issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not isinstance(meta.get(k), str) or not meta[k]:
            raise RuntimeError(f"discovery document has no {k}")
    if not same_issuer(meta["issuer"], issuer):
        raise RuntimeError(f"discovery issuer {meta['issuer']} does not match OIDC_ISSUER")
    origin = _origin(meta["issuer"])
    for k in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if _origin(meta[k]) != origin:
            raise RuntimeError(f"{k} is not on the issuer's origin")
    with _lock:
        _cache["metadata"] = (time.time(), meta)
    return meta


def jwks(force: bool = False) -> dict[str, Jwk]:
    with _lock:
        hit = _cache.get("jwks")
    if hit:
        age = time.time() - hit[0]
        if (not force and age < CACHE_TTL) or (force and age < JWKS_FORCE_REFRESH_MIN):
            return parse_jwks(hit[1])  # type: ignore[arg-type]
    raw = _get_json(metadata()["jwks_uri"])
    if not parse_jwks(raw):
        raise RuntimeError("JWKS has no usable keys")
    with _lock:
        _cache["jwks"] = (time.time(), raw)
    return parse_jwks(raw)


def authorization_url(state: str, nonce: str, server_challenge: str) -> str:
    q = urlencode({
        "client_id": settings.oidc_client_id.strip(),
        "redirect_uri": callback_url(),
        "response_type": "code",
        "scope": settings.oidc_scope.strip() or "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": server_challenge,
        "code_challenge_method": "S256",
    }, quote_via=quote)
    endpoint = metadata()["authorization_endpoint"]
    return endpoint + ("&" if "?" in endpoint else "?") + q


def exchange_code(code: str, server_verifier: str) -> str:
    """認可コードを交換して ID トークンを返す"""
    res = httpx.post(
        metadata()["token_endpoint"],
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": callback_url(),
            "client_id": settings.oidc_client_id.strip(),
            "client_secret": settings.oidc_client_secret.strip(),
            "code_verifier": server_verifier,
        },
        headers={"Accept": "application/json"},
        timeout=10,
        follow_redirects=False,
    )
    if res.status_code != 200:
        # 応答には秘密は含まれない（error と error_description だけ）
        raise RuntimeError(f"token endpoint returned {res.status_code}: {res.text[:200]}")
    id_token = res.json().get("id_token")
    if not isinstance(id_token, str) or not id_token:
        raise RuntimeError("token response has no id_token")
    return id_token


def verify(id_token: str, nonce: str) -> dict:
    """ID トークンを確かめる。知らない鍵（鍵の入れ替え直後）なら、公開鍵を 1 回だけ読み直す"""
    issuer = metadata()["issuer"]

    def check(keys: dict[str, Jwk]) -> dict:
        return verify_id_token(
            id_token, keys, issuer, settings.oidc_client_id.strip(), nonce, settings.oidc_require_mfa
        )

    try:
        return check(jwks(False))
    except Rejected as e:
        if e.reason != "unknown_kid":
            raise
        return check(jwks(True))
