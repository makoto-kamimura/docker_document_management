from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.seed import init_db
from app.api.routes import (
    health, auth, documents, family, notifications, search, logs, tenants, users, groups,
)
from app.services.storage import ensure_buckets

# create_all がメタデータを認識できるよう全モデルを import する
from app.models import tenant as _tenant  # noqa: F401
from app.models import user as _user  # noqa: F401
from app.models import document as _document  # noqa: F401
from app.models import access_log as _access_log  # noqa: F401
from app.models import document_permission as _document_permission  # noqa: F401
from app.models import group as _group  # noqa: F401
from app.models import read_receipt as _read_receipt  # noqa: F401
from app.models import document_tag as _document_tag  # noqa: F401
from app.models import document_version as _document_version  # noqa: F401
from app.models import family as _family  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    # テーブル作成・テナント移行・初期ユーザー投入 (app/db/seed.py)
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
app.include_router(tenants.router, prefix=settings.api_v1_prefix)
app.include_router(users.router, prefix=settings.api_v1_prefix)
app.include_router(groups.router, prefix=settings.api_v1_prefix)
app.include_router(documents.router, prefix=settings.api_v1_prefix)
app.include_router(family.router, prefix=settings.api_v1_prefix)
app.include_router(notifications.router, prefix=settings.api_v1_prefix)
app.include_router(search.router, prefix=settings.api_v1_prefix)
app.include_router(logs.router, prefix=settings.api_v1_prefix)


@app.get("/")
def root() -> dict:
    return {"app": settings.app_name, "docs": "/docs"}
