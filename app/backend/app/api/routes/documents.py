import uuid

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    co_member_user_ids, ensure_can_access, get_current_user, is_admin, require_tenant,
    same_tenant, tenant_clause, tenant_scope,
)
from app.db.session import get_db
from app.models.access_log import AccessLog, Action
from app.models.document import Document, Sensitivity, OcrStatus
from app.models.document_permission import DocumentPermission, PermissionLevel
from app.models.document_tag import DocumentTag
from app.models.family import DocumentInsight
from app.models.document_version import DocumentVersion
from app.models.read_receipt import DocumentReadReceipt
from app.models.user import User
from app.schemas.document import DocumentDetail, DocumentRead, DocumentUpdate, VersionRead
from app.schemas.acl import PermissionRead, PermissionUpsert
from app.schemas.read import ReadReceiptRead
from app.services import family, storage, summarize, pdf_export, search

router = APIRouter(prefix="/documents", tags=["documents"])


def _mark_read(db: Session, doc_id, user_id) -> None:
    """既読記録を upsert する（初回のみ read_at 設定, F-32）。"""
    exists = db.scalar(
        select(DocumentReadReceipt).where(
            DocumentReadReceipt.document_id == doc_id,
            DocumentReadReceipt.user_id == user_id,
        )
    )
    if exists is None:
        db.add(DocumentReadReceipt(document_id=doc_id, user_id=user_id))


def _tags_for(db: Session, doc_id) -> list[str]:
    """1ドキュメントのタグ一覧 (F-17)。"""
    return list(
        db.scalars(
            select(DocumentTag.tag)
            .where(DocumentTag.document_id == doc_id)
            .order_by(DocumentTag.tag.asc())
        ).all()
    )


def _tags_map(db: Session, doc_ids: list) -> dict:
    """複数ドキュメントのタグをまとめて取得する（一覧のN+1回避）。"""
    if not doc_ids:
        return {}
    rows = db.execute(
        select(DocumentTag.document_id, DocumentTag.tag)
        .where(DocumentTag.document_id.in_(doc_ids))
        .order_by(DocumentTag.tag.asc())
    ).all()
    out: dict = {}
    for doc_id, tag in rows:
        out.setdefault(doc_id, []).append(tag)
    return out


def _decorate(db: Session, docs: list, user: User) -> list:
    """レスポンス用の一時属性（既読・タグ・解析結果・自分の対応・家族の確認人数）を付与する。

    一覧でも N+1 にならないようまとめて取得する。pydantic from_attributes が読む。
    """
    doc_ids = [d.id for d in docs]
    tags = _tags_map(db, doc_ids)
    insights = {
        i.document_id: i
        for i in db.scalars(select(DocumentInsight).where(DocumentInsight.document_id.in_(doc_ids))).all()
    } if doc_ids else {}
    members = family.family_ids_map(db, docs)
    reads, actions = family.status_maps(db, doc_ids)
    for d in docs:
        d.is_read = (d.id, user.id) in reads
        d.tags = tags.get(d.id, [])
        ins = insights.get(d.id)
        d.importance = ins.importance if ins else None
        d.deadline = ins.deadline if ins else None
        d.event_date = ins.event_date if ins else None
        d.audience = ins.audience if ins else None
        d.keywords = list(ins.keywords or []) if ins else []
        mine = actions.get((d.id, user.id))
        d.my_action = mine.status.value if mine else None
        ids = members.get(d.id, [])
        d.family_total = len(ids)
        d.family_confirmed = sum(
            family.is_confirmed(
                reads.get((d.id, u)),
                actions[(d.id, u)].status if (d.id, u) in actions else None,
            )
            for u in ids
        )
    return docs


def _reindex(db: Session, doc: Document) -> None:
    """ドキュメントを検索索引へ再登録する（メタ/OCR/タグ/要約を反映, F-23〜F-26）。

    保存済みの要約 `{id}/summary.txt` があれば検索対象に含める。
    """
    summary = ""
    try:
        summary = storage.get_object(
            doc.storage_location, f"{doc.id}/summary.txt"
        ).decode("utf-8", "ignore")
    except Exception:
        summary = ""
    try:
        search.index_document(
            str(doc.id),
            {
                "title": doc.title,
                "ocr_text": doc.ocr_text or "",
                "summary": summary,
                "tags": _tags_for(db, doc.id),
                "category": doc.category,
                "document_type": doc.document_type,
                "owner_id": str(doc.owner_id),
                "tenant_id": str(doc.tenant_id) if doc.tenant_id else None,
                "created_at": doc.created_at.isoformat(),
            },
        )
    except Exception as exc:  # noqa: BLE001 - 索引失敗で編集自体は失敗させない
        print(f"[documents] reindex failed {doc.id}: {exc}")


_MEDIA_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "pdf": "application/pdf",
}


def _media_type(file_format: str | None) -> str:
    return _MEDIA_TYPES.get((file_format or "").lower(), "application/octet-stream")


@router.get("", response_model=list[DocumentRead])
def list_documents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    scope: uuid.UUID | None = Depends(tenant_scope),
):
    """ドキュメント一覧 (F-21)。

    まず**テナント**で絞り込み、その中で テナント管理者は全件、それ以外は
    所有 / per-user ACL / 所有者と同一グループ のドキュメント (F-36)。
    各ドキュメントに現在ユーザー基準の既読フラグ is_read を付与する (F-32)。
    """
    stmt = (
        select(Document)
        .where(tenant_clause(Document.tenant_id, scope))
        .order_by(Document.created_at.desc())
    )
    if not is_admin(user):
        granted = select(DocumentPermission.document_id).where(
            DocumentPermission.user_id == user.id
        )
        co_members = co_member_user_ids(db, user.id)  # 自分を含む同一グループの全員
        stmt = stmt.where(
            (Document.owner_id == user.id)
            | (Document.id.in_(granted))
            | (Document.owner_id.in_(co_members))
        )
    return _decorate(db, list(db.scalars(stmt).all()), user)


@router.post("", response_model=DocumentRead, status_code=201)
def create_document(
    title: str = Form(...),
    sensitivity: Sensitivity = Form(Sensitivity.internal),
    mode: str = Form("color"),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: uuid.UUID = Depends(require_tenant),
):
    """撮影/PDFのアップロードと登録 (F-01/F-02/F-10/F-12/F-17/F-20)。

    複数ページ（撮影連写/ライブラリ取込）を1ドキュメントとして受け付ける。生ページは
    `{id}/pages/{i:03d}` に保存し、画像処理(台形補正/補正/モード)・PDF統合・OCRは
    ワーカーへ委譲する（ステータス pending, F-13）。`mode` は color/gray/bw。
    """
    if not files:
        raise HTTPException(status_code=400, detail="ファイルが指定されていません")

    first = files[0]
    fmt = (first.filename or "").split(".")[-1].lower() or "jpg"
    location = storage.resolve_location(sensitivity)
    doc = Document(
        id=uuid.uuid4(),  # ストレージキーを確定させるため明示生成（commit前に id を使う）
        tenant_id=tenant_id,
        title=title,
        sensitivity=sensitivity,
        storage_location=location,
        ocr_status=OcrStatus.pending,
        owner_id=user.id,
        file_format=fmt,
        page_count=len(files),
    )
    # ページを決定的キーで保存（ワーカーが page_count から再構成する）
    first_key = f"{doc.id}/pages/000"
    for i, f in enumerate(files):
        storage.put_object(
            location, f"{doc.id}/pages/{i:03d}", f.file.read(),
            f.content_type or "application/octet-stream",
        )
    doc.storage_key = first_key  # 暫定プレビュー（ワーカーが preview.jpg を生成後はそちら優先）
    # 撮影モードを quality 経由でワーカーに渡すための簡易メタ保存
    storage.put_object(location, f"{doc.id}/mode", mode.encode(), "text/plain")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    # 自分のアップロードは既読扱い (F-32)
    _mark_read(db, doc.id, user.id)
    db.commit()
    return _decorate(db, [doc], user)[0]


@router.get("/{doc_id}", response_model=DocumentDetail)
def get_document(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ドキュメント取得 + 閲覧ログ記録 (F-22, F-28)。"""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.view))
    _mark_read(db, doc.id, user.id)  # 閲覧で既読化 (F-32)
    db.commit()
    return _decorate(db, [doc], user)[0]


@router.get("/{doc_id}/content")
def get_document_content(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """プレビュー画像のバイトを返す (F-22)。

    ワーカーが生成した処理済みプレビュー `{id}/preview.jpg` を優先し、未生成なら
    生ページ(storage_key)にフォールバックする。
    """
    doc = db.get(Document, doc_id)
    if doc is None or not doc.storage_key:
        raise HTTPException(status_code=404, detail="ファイルが見つかりません")
    # サムネイル表示にも使うため既読化しない（既読は詳細を開いた時点 GET /documents/{id} で記録。
    # 一覧のサムネイルを見ただけで家族の「確認済み」にならないようにする）
    ensure_can_access(db, doc, user, PermissionLevel.view)
    try:
        data = storage.get_object(doc.storage_location, f"{doc.id}/preview.jpg")
        return Response(content=data, media_type="image/jpeg")
    except Exception:
        data = storage.get_object(doc.storage_location, doc.storage_key)
        return Response(content=data, media_type=_media_type(doc.file_format))


@router.get("/{doc_id}/quality")
def get_document_quality(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """画質チェック結果（ブレ/暗さ/影/解像度の警告, F-09/F-07）。未生成なら空。"""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    try:
        raw = storage.get_object(doc.storage_location, f"{doc.id}/quality.json")
        import json
        return json.loads(raw)
    except Exception:
        return {"warnings": []}


@router.get("/{doc_id}/document-pdf")
def get_document_pdf(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """OCRワーカーが生成・保存した検索可能PDF(電子資料)を返す (F-14)。

    生成は撮影後の非同期処理で行われるため、未生成なら 404 を返す。
    """
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    key = f"{doc.id}/document.pdf"  # ocr_worker.document_pdf_key と同一規則
    try:
        data = storage.get_object(doc.storage_location, key)
    except Exception:
        raise HTTPException(status_code=404, detail="電子資料PDFはまだ生成されていません")

    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.download))
    db.commit()
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="document_{doc.id}.pdf"'},
    )


@router.get("/{doc_id}/ocr-pdf")
def export_ocr_text_pdf(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """OCRで認識した文字を集約した電子資料PDF（全文）を生成して返す (F-13/F-14系)。

    要約ではなくOCR抽出テキストの全文をPDF化する。OCR未完了なら 409。
    """
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    if doc.ocr_status != OcrStatus.done or not doc.ocr_text:
        raise HTTPException(status_code=409, detail="OCR未完了のためテキストPDFを生成できません")

    pdf_bytes = pdf_export.build_ocr_text_pdf(doc.title, doc.ocr_text)
    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.download))
    db.commit()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="ocr_text_{doc.id}.pdf"'},
    )


@router.get("/{doc_id}/pdf")
def export_summary_pdf(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """OCRテキストを要約し、要約電子資料PDFを生成して返す (F-14系)。"""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    if doc.ocr_status != OcrStatus.done or not doc.ocr_text:
        raise HTTPException(status_code=409, detail="OCR未完了のため要約PDFを生成できません")

    summary = summarize.summarize(doc.ocr_text)
    pdf_bytes = pdf_export.build_summary_pdf(doc.title, summary)

    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.download))
    db.commit()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="summary_{doc.id}.pdf"'},
    )


@router.patch("/{doc_id}", response_model=DocumentRead)
def update_document(
    doc_id: uuid.UUID,
    payload: DocumentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """メタデータ/タグ/OCRテキストの編集 (F-16/F-17)。編集権限が必要。

    指定フィールドのみ更新し、タグは全置換する。機密度変更時は保存先を再判定する。
    変更後は検索索引へ再登録する（OCR修正・タグ追加が検索に即反映）。
    """
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.edit)

    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        doc.title = data["title"]
    if "category" in data:
        doc.category = data["category"]
    if "document_type" in data:
        doc.document_type = data["document_type"]
    if "retention_until" in data:
        doc.retention_until = data["retention_until"]
    if "sensitivity" in data and data["sensitivity"] is not None:
        doc.sensitivity = data["sensitivity"]
        doc.storage_location = storage.resolve_location(doc.sensitivity)
    ocr_changed = "ocr_text" in data and data["ocr_text"] is not None and data["ocr_text"] != doc.ocr_text
    if ocr_changed:
        doc.ocr_text = data["ocr_text"]

    if "tags" in data and data["tags"] is not None:
        # タグ全置換（重複/空白除去）
        db.execute(
            DocumentTag.__table__.delete().where(DocumentTag.document_id == doc.id)
        )
        seen = set()
        for raw in data["tags"]:
            t = (raw or "").strip()
            if t and t not in seen:
                seen.add(t)
                db.add(DocumentTag(document_id=doc.id, tag=t))

    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.edit))
    db.commit()
    db.refresh(doc)
    if ocr_changed:  # OCR を手直ししたら重要度・期限も解析し直す（手動修正済みの解析結果は保持）
        family.apply_analysis(db, doc, doc.ocr_text)
    _reindex(db, doc)
    return _decorate(db, [doc], user)[0]


@router.get("/{doc_id}/pages/{index}/content")
def get_page_content(
    doc_id: uuid.UUID,
    index: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ページ単位の処理済み画像を返す（ページめくりビューア用, F-22）。

    ワーカーが保存した処理済みページ `{id}/proc/{i:03d}` を優先し、無ければ生ページに
    フォールバックする。
    """
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    if index < 0 or index >= max(doc.page_count, 1):
        raise HTTPException(status_code=404, detail="ページが範囲外です")
    try:
        data = storage.get_object(doc.storage_location, f"{doc.id}/proc/{index:03d}")
        return Response(content=data, media_type="image/jpeg")
    except Exception:
        try:
            data = storage.get_object(doc.storage_location, f"{doc.id}/pages/{index:03d}")
            return Response(content=data, media_type=_media_type(doc.file_format))
        except Exception:
            raise HTTPException(status_code=404, detail="ページ画像が見つかりません")


@router.post("/{doc_id}/print-log", status_code=204)
def log_print(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """印刷操作のログ記録 (F-27/F-29)。閲覧権限が必要。"""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.print))
    db.commit()


@router.get("/{doc_id}/versions", response_model=list[VersionRead])
def list_versions(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """バージョン履歴の一覧 (F-19)。閲覧権限が必要。"""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.view)
    rows = db.scalars(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == doc_id)
        .order_by(DocumentVersion.version.desc())
    ).all()
    return rows


@router.post("/{doc_id}/versions", response_model=DocumentRead, status_code=201)
def create_version(
    doc_id: uuid.UUID,
    note: str = Form(""),
    mode: str = Form("color"),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ドキュメントの差し替え（新バージョン登録, F-19）。編集権限が必要。

    現行の成果物キー/ページ数/OCRテキストを履歴へ退避し、新しいページを保存して
    version を加算、OCRワーカーで再処理させる（ocr_status=pending）。
    """
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    ensure_can_access(db, doc, user, PermissionLevel.edit)
    if not files:
        raise HTTPException(status_code=400, detail="ファイルが指定されていません")

    # 現行を履歴へ退避
    db.add(
        DocumentVersion(
            document_id=doc.id,
            version=doc.version,
            storage_key=doc.storage_key,
            page_count=doc.page_count,
            file_format=doc.file_format,
            ocr_text=doc.ocr_text,
            note=note or None,
            created_by=user.id,
        )
    )

    # 新バージョンのページを新しいキー空間 v{n}/pages に保存（旧版の成果物を上書きしない）
    new_version = doc.version + 1
    fmt = (files[0].filename or "").split(".")[-1].lower() or "jpg"
    for i, f in enumerate(files):
        storage.put_object(
            doc.storage_location, f"{doc.id}/v{new_version}/pages/{i:03d}",
            f.file.read(), f.content_type or "application/octet-stream",
        )
    # ワーカーは `{id}/pages/{i}` を読むため、新バージョンを現行ページとして配置し直す
    pages = []
    for i in range(len(files)):
        pages.append(
            storage.get_object(doc.storage_location, f"{doc.id}/v{new_version}/pages/{i:03d}")
        )
    for i, data in enumerate(pages):
        storage.put_object(
            doc.storage_location, f"{doc.id}/pages/{i:03d}", data, "application/octet-stream"
        )
    storage.put_object(doc.storage_location, f"{doc.id}/mode", mode.encode(), "text/plain")

    doc.version = new_version
    doc.page_count = len(files)
    doc.file_format = fmt
    doc.ocr_status = OcrStatus.pending
    doc.ocr_text = None
    db.add(AccessLog(document_id=doc.id, user_id=user.id, action=Action.edit))
    db.commit()
    db.refresh(doc)
    return _decorate(db, [doc], user)[0]


# ---- ドキュメント単位ACL (F-36/F-37)。管理者 or 所有者のみ操作可 ----


def _load_doc_for_acl(doc_id: uuid.UUID, db: Session, user: User) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None or not same_tenant(user, doc.tenant_id):
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    if not is_admin(user) and doc.owner_id != user.id:
        raise HTTPException(status_code=403, detail="権限設定は管理者または所有者のみ可能です")
    return doc


@router.get("/{doc_id}/permissions", response_model=list[PermissionRead])
def list_permissions(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _load_doc_for_acl(doc_id, db, user)
    rows = db.execute(
        select(DocumentPermission, User)
        .join(User, User.id == DocumentPermission.user_id)
        .where(DocumentPermission.document_id == doc_id)
        .order_by(User.created_at.asc())
    ).all()
    return [
        PermissionRead(
            id=p.id,
            user_id=p.user_id,
            user_email=u.email,
            user_name=u.name,
            level=p.level,
        )
        for p, u in rows
    ]


@router.put("/{doc_id}/permissions/{user_id}", response_model=PermissionRead)
def upsert_permission(
    doc_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: PermissionUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = _load_doc_for_acl(doc_id, db, user)
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="対象ユーザーが見つかりません")
    if target.tenant_id != doc.tenant_id:
        raise HTTPException(status_code=400, detail="別のテナントのユーザーには共有できません")
    if target.id == doc.owner_id:
        raise HTTPException(status_code=400, detail="所有者には権限を付与できません（常にフル権限）")

    perm = db.scalar(
        select(DocumentPermission).where(
            DocumentPermission.document_id == doc_id,
            DocumentPermission.user_id == user_id,
        )
    )
    if perm is None:
        perm = DocumentPermission(document_id=doc_id, user_id=user_id, level=payload.level)
        db.add(perm)
    else:
        perm.level = payload.level
    db.commit()
    db.refresh(perm)
    return PermissionRead(
        id=perm.id,
        user_id=target.id,
        user_email=target.email,
        user_name=target.name,
        level=perm.level,
    )


@router.delete("/{doc_id}/permissions/{user_id}", status_code=204)
def remove_permission(
    doc_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _load_doc_for_acl(doc_id, db, user)
    perm = db.scalar(
        select(DocumentPermission).where(
            DocumentPermission.document_id == doc_id,
            DocumentPermission.user_id == user_id,
        )
    )
    if perm is not None:
        db.delete(perm)
        db.commit()


@router.get("/{doc_id}/reads", response_model=list[ReadReceiptRead])
def list_read_receipts(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """既読者一覧（誰がいつ読んだか, F-32/F-30）。管理者またはドキュメント所有者のみ。"""
    doc = db.get(Document, doc_id)
    if doc is None or not same_tenant(user, doc.tenant_id):
        raise HTTPException(status_code=404, detail="ドキュメントが見つかりません")
    if not is_admin(user) and doc.owner_id != user.id:
        raise HTTPException(status_code=403, detail="既読者の確認は管理者または所有者のみ可能です")
    rows = db.execute(
        select(DocumentReadReceipt, User)
        .join(User, User.id == DocumentReadReceipt.user_id)
        .where(DocumentReadReceipt.document_id == doc_id)
        .order_by(DocumentReadReceipt.read_at.desc())
    ).all()
    return [
        ReadReceiptRead(
            user_id=u.id, user_name=u.name, user_email=u.email, read_at=r.read_at
        )
        for r, u in rows
    ]
