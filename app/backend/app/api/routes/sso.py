"""SSO（OpenID Connect）でのログイン。Web とモバイルで同じ流れを使う。

1. （連携のときだけ）POST /me/identities/sso/intent … ログイン中の利用者に、使い捨ての intent を発行
2. GET  /auth/sso/start    … クライアントが作った code_challenge を受け取り、認証サーバーへ送る
3. GET  /auth/sso/callback … 認証サーバーから戻る。使い捨ての結果コードを付けてクライアントへ戻す
4. POST /auth/sso/exchange … 結果コードと code_verifier を引き換える。ここでログイン / 連携が成立する

新しい利用者は作らない。SSO で入れるのは、パスワードでログインしたうえで連携した人だけ。
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import LOGIN_SSO, create_access_token, decode_token, login_method
from app.db.session import get_db
from app.models.sso import OAuthFlow, UserIdentity
from app.models.user import User
from app.services import oidc

router = APIRouter(tags=["sso"])
log = logging.getLogger("uvicorn.error.sso")

FLOW_TTL = timedelta(seconds=600)   # 開始から認証サーバーでの操作を終えるまでの猶予
RESULT_TTL = timedelta(seconds=60)  # 結果コードの有効期間

_optional_bearer = HTTPBearer(auto_error=False)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _ensure_enabled() -> None:
    if not oidc.enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=303)


@router.get("/auth/providers")
def providers() -> dict:
    """ログイン画面が「SSO でログイン」を出すかどうかと、その名前"""
    on = oidc.enabled()
    return {"sso": on, "sso_name": oidc.display_name() if on else None}


@router.get("/auth/sso/start")
def start(
    mode: str = "",
    client: str = "",
    code_challenge: str = "",
    redirect_uri: str = "",
    intent: str = "",
    db: Session = Depends(get_db),
):
    _ensure_enabled()
    if not oidc.is_valid_challenge(code_challenge):
        raise HTTPException(status_code=400, detail="code_challenge が正しくありません")
    if client == "web":
        return_to = oidc.web_return_url()
    elif client == "mobile":
        if not oidc.mobile_redirect_allowed(redirect_uri, oidc.mobile_redirect_prefixes()):
            raise HTTPException(status_code=400, detail="redirect_uri が許可されていません")
        return_to = redirect_uri
    else:
        raise HTTPException(status_code=400, detail="client が正しくありません")
    if mode not in ("login", "link"):
        raise HTTPException(status_code=400, detail="mode が正しくありません")

    now = _now()
    db.execute(delete(OAuthFlow).where(OAuthFlow.expires_at < now))
    db.commit()

    state, nonce, server_verifier = oidc.random_token(), oidc.random_token(), oidc.random_token()
    fields = dict(
        state_hash=oidc.hash_token(state), nonce=nonce, server_verifier=server_verifier,
        client_challenge=code_challenge, return_to=return_to, expires_at=now + FLOW_TTL,
    )
    if mode == "login":
        db.add(OAuthFlow(mode="login", created_at=now, **fields))
        db.commit()
    else:
        # intent は 1 回だけ使える。使ったら消して state に進める
        flow = db.scalar(
            select(OAuthFlow)
            .where(
                OAuthFlow.intent_hash == oidc.hash_token(intent),
                OAuthFlow.mode == "link",
                OAuthFlow.expires_at > now,
            )
            .with_for_update()
        )
        if flow is None:
            db.rollback()
            return _redirect(oidc.with_query(return_to, "error", "expired"))
        flow.intent_hash = None
        for k, v in fields.items():
            setattr(flow, k, v)
        db.commit()

    try:
        url = oidc.authorization_url(state, nonce, oidc.pkce_challenge(server_verifier))
    except Exception as e:  # noqa: BLE001
        log.error("sso: cannot reach the identity provider: %s", e)
        raise HTTPException(status_code=502, detail="認証サーバーに接続できません") from None
    return _redirect(url)


_CALLBACK_ERROR_HTML = (
    "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\">"
    "<p>ログインの有効期限が切れたか、正しくない要求です。アプリに戻って、もう一度やり直してください。</p>"
)


@router.get("/auth/sso/callback")
def callback(request: Request, db: Session = Depends(get_db)):
    try:
        return _redirect(_handle_callback(request, db))
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.warning("sso callback rejected: %s", e)
        return HTMLResponse(_CALLBACK_ERROR_HTML, status_code=400)


def _handle_callback(request: Request, db: Session) -> str:
    if not oidc.enabled():
        raise RuntimeError("sso is disabled")
    q = request.query_params
    # state は 1 回だけ使える
    flow = db.scalar(
        select(OAuthFlow)
        .where(OAuthFlow.state_hash == oidc.hash_token(q.get("state", "")), OAuthFlow.expires_at > _now())
        .with_for_update()
    )
    if flow is None or not flow.return_to:
        raise RuntimeError("unknown or expired state")
    flow.state_hash = None
    db.commit()

    result = _finish(flow, q.get("code"), q.get("error"), db)
    if isinstance(result, str):
        return_to = flow.return_to
        db.delete(flow)
        db.commit()
        return oidc.with_query(return_to, "error", result)
    subject, email = result
    code = oidc.random_token()
    flow.result_hash = oidc.hash_token(code)
    flow.result_subject = subject
    flow.result_email = email
    flow.nonce = None
    flow.server_verifier = None
    flow.expires_at = _now() + RESULT_TTL
    db.commit()
    return oidc.with_query(flow.return_to, "code", code)


def _finish(flow: OAuthFlow, code, error, db: Session) -> tuple[str, str | None] | str:
    """認証サーバーから受け取ったものを確かめ、(sub, email) を返す。失敗したときはクライアントに返す理由"""
    if error is not None:
        return "cancelled"
    if not code or not flow.nonce or not flow.server_verifier:
        return "failed"
    try:
        id_token = oidc.exchange_code(code, flow.server_verifier)
    except Exception as e:  # noqa: BLE001
        log.warning("sso token exchange failed: %s", e)
        return "failed"
    try:
        claims = oidc.verify(id_token, flow.nonce)
    except oidc.Rejected as e:
        if e.reason == "mfa_required":
            log.info("sso: login without MFA was rejected")
            return "mfa_required"
        log.warning("sso id_token rejected: %s", e.reason)
        return "failed"
    except Exception as e:  # noqa: BLE001
        log.warning("sso id_token could not be verified: %s", e)
        return "failed"
    if flow.mode == "login":
        linked = db.scalar(
            select(UserIdentity.id).where(
                UserIdentity.provider == oidc.PROVIDER, UserIdentity.subject == claims["sub"]
            )
        )
        if linked is None:
            log.info("sso login: account is not linked")
            return "not_linked"
    email = claims.get("email")
    return claims["sub"], email if isinstance(email, str) else None


class ExchangeIn(BaseModel):
    code: str = ""
    code_verifier: str = ""


def _bearer_user(creds: HTTPAuthorizationCredentials | None, db: Session) -> User | None:
    """交換は認証なしの経路なので、Bearer があれば自分で確かめる（「SSO だけ」も守らせる）"""
    if creds is None or creds.scheme.lower() != "bearer":
        return None
    try:
        payload = decode_token(creds.credentials)
        user = db.get(User, uuid.UUID(payload.get("sub")))
    except (JWTError, ValueError, TypeError):
        return None
    if user is None or not oidc.login_method_allowed(user, login_method(payload)):
        return None
    return user


@router.post("/auth/sso/exchange")
def exchange(
    body: ExchangeIn,
    creds: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: Session = Depends(get_db),
) -> dict:
    """結果コードを、開始したクライアントの code_verifier と引き換える"""
    _ensure_enabled()
    unauthenticated = HTTPException(status_code=401, detail="認証情報が無効です")
    # 結果コードは 1 回だけ使える。code_verifier が違っても消す（総当たりさせない）
    flow = db.scalar(
        select(OAuthFlow)
        .where(OAuthFlow.result_hash == oidc.hash_token(body.code.strip()), OAuthFlow.expires_at > _now())
        .with_for_update()
    )
    if flow is not None:
        mode, user_id, subject, email, challenge = (
            flow.mode, flow.user_id, flow.result_subject, flow.result_email, flow.client_challenge
        )
        db.delete(flow)
        db.commit()
    if flow is None or not subject or not oidc.verify_pkce(body.code_verifier, challenge or ""):
        if flow is not None:
            log.warning("sso exchange: code_verifier mismatch")
        raise unauthenticated

    if mode == "login":
        identity = db.scalar(
            select(UserIdentity).where(UserIdentity.provider == oidc.PROVIDER, UserIdentity.subject == subject)
        )
        user = db.get(User, identity.user_id) if identity else None
        if user is None:
            raise unauthenticated
        identity.last_login_at = _now()
        db.commit()
        log.info("sso login succeeded user_id=%s", user.id)
        token = create_access_token(subject=str(user.id), role=user.role.value, method=LOGIN_SSO)
        return {"mode": "login", "access_token": token, "token_type": "bearer"}

    # 連携: ログイン中の本人と、連携を始めた本人が同じであること
    me = _bearer_user(creds, db)
    if me is None:
        raise unauthenticated
    if user_id != me.id:
        log.warning("sso link: user mismatch user_id=%s", me.id)
        raise HTTPException(status_code=403, detail="この操作の権限がありません")
    if oidc.link_denied(me.email, oidc.link_deny_domains()):
        raise HTTPException(status_code=400, detail="デモ用のアカウントには SSO を連携できません")
    owner = db.scalar(
        select(UserIdentity).where(UserIdentity.provider == oidc.PROVIDER, UserIdentity.subject == subject)
    )
    if owner is not None and owner.user_id != me.id:
        raise HTTPException(status_code=409, detail="この SSO のアカウントは、ほかの利用者に連携されています")
    if owner is not None:
        owner.email = email
    else:
        mine = db.scalar(
            select(UserIdentity.id).where(UserIdentity.user_id == me.id, UserIdentity.provider == oidc.PROVIDER)
        )
        if mine is not None:
            raise HTTPException(
                status_code=409, detail="別の SSO のアカウントと連携済みです。解除してから連携してください"
            )
        db.add(UserIdentity(
            user_id=me.id, provider=oidc.PROVIDER, subject=subject, email=email, created_at=_now()
        ))
    db.commit()
    log.info("sso account linked user_id=%s", me.id)
    return {"mode": "link", "email": email}


@router.post("/me/identities/sso/intent")
def intent(me: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """連携を始める。ブラウザの遷移では Bearer を送れないので、ここで使い捨ての intent を渡す"""
    _ensure_enabled()
    if oidc.link_denied(me.email, oidc.link_deny_domains()):
        raise HTTPException(status_code=400, detail="デモ用のアカウントには SSO を連携できません")
    token = oidc.random_token()
    now = _now()
    db.add(OAuthFlow(
        mode="link", user_id=me.id, intent_hash=oidc.hash_token(token),
        expires_at=now + FLOW_TTL, created_at=now,
    ))
    db.commit()
    return {"intent": token}


@router.get("/me/identities")
def identities(request: Request, me: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """自分の連携の一覧と、SSO が使えるか"""
    rows = db.scalars(
        select(UserIdentity).where(UserIdentity.user_id == me.id).order_by(UserIdentity.provider)
    ).all()
    on = oidc.enabled()
    return {
        "sso_enabled": on,
        "sso_name": oidc.display_name() if on else None,
        "can_link": on and not oidc.link_denied(me.email, oidc.link_deny_domains()),
        "identities": [
            {
                "provider": r.provider,
                "email": r.email,
                "created_at": r.created_at.isoformat() + "Z",
                "last_login_at": r.last_login_at.isoformat() + "Z" if r.last_login_at else None,
            }
            for r in rows
        ],
        "sso_only": bool(me.sso_only),
        "login_method": getattr(request.state, "login_method", "pwd"),
    }


@router.delete("/me/identities/sso")
def unlink(me: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """SSO の連携を解除する。「SSO だけ」も外す（連携がなければ SSO では入れないため）"""
    removed = db.execute(
        delete(UserIdentity).where(UserIdentity.user_id == me.id, UserIdentity.provider == oidc.PROVIDER)
    ).rowcount
    me.sso_only = False
    db.commit()
    if removed:
        log.info("sso account unlinked user_id=%s", me.id)
    return {"unlinked": bool(removed)}


class SsoOnlyIn(BaseModel):
    enabled: bool


@router.put("/me/sso-only")
def set_sso_only(
    body: SsoOnlyIn, request: Request, me: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    """「SSO だけでログインする」を切り替える。オンにできるのは、連携していて、いま SSO でログインしている人だけ。

    オンにすると、パスワードで入っていたほかの端末のログインもその時点で切れる（get_current_user が確かめる）
    """
    _ensure_enabled()
    if body.enabled:
        linked = db.scalar(
            select(UserIdentity.id).where(UserIdentity.user_id == me.id, UserIdentity.provider == oidc.PROVIDER)
        )
        if linked is None:
            raise HTTPException(status_code=400, detail="先に SSO のアカウントを連携してください")
        if getattr(request.state, "login_method", "pwd") != LOGIN_SSO:
            raise HTTPException(
                status_code=400,
                detail="SSO でログインし直してから有効にしてください（SSO で入れることを確かめるため）",
            )
    me.sso_only = body.enabled
    db.commit()
    log.info("sso-only changed user_id=%s enabled=%s", me.id, body.enabled)
    return {"sso_only": body.enabled}
