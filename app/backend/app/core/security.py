from datetime import datetime, timedelta, timezone

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ログインした方法。トークンの amr クレームに入れ、「SSO だけ」の判定に使う（以前のトークン＝方法なしは pwd）
LOGIN_PASSWORD = "pwd"
LOGIN_SSO = "sso"


def create_access_token(subject: str, role: str, method: str = LOGIN_PASSWORD) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": subject, "role": role, "exp": expire, "amr": [method]}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def login_method(payload: dict) -> str:
    amr = payload.get("amr")
    return LOGIN_SSO if isinstance(amr, list) and LOGIN_SSO in amr else LOGIN_PASSWORD


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
