from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, engine, SessionLocal
from app.api.routes import health, auth, documents, search, logs, users, groups
from app.services.storage import ensure_buckets

# create_all がメタデータを認識できるよう全モデルを import する
from app.models import user as _user  # noqa: F401
from app.models import document as _document  # noqa: F401
from app.models import access_log as _access_log  # noqa: F401
from app.models import document_permission as _document_permission  # noqa: F401
from app.models import group as _group  # noqa: F401
from app.models import read_receipt as _read_receipt  # noqa: F401
from app.models import document_tag as _document_tag  # noqa: F401
from app.models import document_version as _document_version  # noqa: F401
from app.models.user import User, Role


def init_db() -> None:
    """テーブル作成と初期管理者ユーザーの投入。

    マイグレーション基盤導入までの暫定措置 (F-33)。開発用に
    既定の管理者が居なければ作成する。認証情報は環境変数で上書き可能。
    """
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        exists = db.scalar(select(User).where(User.email == settings.seed_admin_email))
        if exists is None:
            db.add(
                User(
                    email=settings.seed_admin_email,
                    name="管理者",
                    role=Role.admin,
                    hashed_password=hash_password(settings.seed_admin_password),
                )
            )
            db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    ensure_buckets()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本番では限定すること
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(health.router, prefix=settings.api_v1_prefix)
app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(users.router, prefix=settings.api_v1_prefix)
app.include_router(groups.router, prefix=settings.api_v1_prefix)
app.include_router(documents.router, prefix=settings.api_v1_prefix)
app.include_router(search.router, prefix=settings.api_v1_prefix)
app.include_router(logs.router, prefix=settings.api_v1_prefix)


@app.get("/")
def root() -> dict:
    return {"app": settings.app_name, "docs": "/docs"}
