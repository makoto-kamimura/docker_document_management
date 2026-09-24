"""OCR ワーカー (F-13)。

ステータス pending のドキュメントを取得し、ページ画像のスキャン処理(台形補正/補正/モード)→
複数ページの検索可能PDF統合→OCRテキスト→検索索引登録→プレビュー/品質の保存 を行う。
雛形ではシンプルなポーリングループ。本番は Celery / メッセージキュー化を推奨。
"""

import json
import time
import uuid

import cv2
import numpy as np
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.document import Document, OcrStatus
from app.models.document_tag import DocumentTag
from app.models.family import DocumentInsight
from app.services import family, image_processing, pdf_export, search, storage, summarize

POLL_INTERVAL_SEC = 5
REMINDER_INTERVAL_SEC = 600  # 家族へのリマインド判定の間隔


def document_pdf_key(doc: Document) -> str:
    """生成した検索可能PDF(電子資料)の保存キー（決定的）。"""
    return f"{doc.id}/document.pdf"


def _to_jpeg(image_bytes: bytes) -> bytes:
    """任意画像バイトをプレビュー用JPEGに正規化する。"""
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes() if ok else image_bytes


def _load_pages(doc: Document) -> list[bytes]:
    """`{id}/pages/{i:03d}` を page_count 分読み込む。"""
    pages = []
    for i in range(max(doc.page_count, 1)):
        try:
            pages.append(storage.get_object(doc.storage_location, f"{doc.id}/pages/{i:03d}"))
        except Exception:
            break
    return pages


def _read_mode(doc: Document) -> str:
    try:
        return storage.get_object(doc.storage_location, f"{doc.id}/mode").decode().strip()
    except Exception:
        return image_processing.MODE_COLOR


def _process_document(doc: Document) -> tuple[str, bytes, bytes, dict]:
    """ドキュメントを処理し (ocr_text, document_pdf, preview_jpeg, quality) を返す。"""
    pages = _load_pages(doc)
    if not pages:
        raise RuntimeError("ページが見つかりません")

    # 既存PDFの取込 (F-10): 1ファイルでPDFのとき
    if doc.file_format == "pdf" and len(pages) == 1:
        pdf_bytes, text = pdf_export.build_searchable_pdf_from_pdf(pages[0], settings.ocr_lang)
        # プレビューは元PDF1ページ目を画像化（poppler）。失敗時は document.pdf を返す側で対応。
        preview = b""
        try:
            import tempfile, os, subprocess
            with tempfile.TemporaryDirectory() as tmp:
                ip = os.path.join(tmp, "in.pdf")
                open(ip, "wb").write(pages[0])
                subprocess.run(
                    ["pdftoppm", "-jpeg", "-r", "120", "-singlefile", ip, os.path.join(tmp, "pv")],
                    check=True,
                )
                pv = os.path.join(tmp, "pv.jpg")
                if os.path.exists(pv):
                    preview = open(pv, "rb").read()
        except Exception:
            preview = b""
        return text, pdf_bytes, preview, {"warnings": [], "page_count": 1, "source": "pdf"}

    # 画像ページ: スキャン処理 → 統合PDF
    mode = _read_mode(doc)
    processed: list[bytes] = []
    first_quality: dict = {}
    for i, raw in enumerate(pages):
        proc, q = image_processing.scan_page(raw, mode)
        processed.append(proc)
        storage.put_object(doc.storage_location, f"{doc.id}/proc/{i:03d}", proc, "image/jpeg")
        if i == 0:
            first_quality = q

    pdf_bytes, text = pdf_export.build_searchable_pdf_from_images(processed, settings.ocr_lang)
    preview = _to_jpeg(processed[0])
    first_quality["page_count"] = len(processed)
    return text, pdf_bytes, preview, first_quality


def process_pending() -> None:
    db = SessionLocal()
    try:
        doc = db.scalar(
            select(Document).where(Document.ocr_status == OcrStatus.pending).limit(1)
        )
        if doc is None:
            return

        doc.ocr_status = OcrStatus.processing
        db.commit()

        try:
            text, pdf_bytes, preview, quality = _process_document(doc)
            text = summarize.clean_ocr_text(text)  # OCRノイズ除去（検索/要約/表示の質を底上げ）

            doc.ocr_text = text
            doc.ocr_status = OcrStatus.done
            db.commit()

            # 文書解析（重要度・期限・対象）。自動命名のタイトル/未設定カテゴリもここで補う
            try:
                family.apply_analysis(db, doc, text)
            except Exception as ana_exc:  # noqa: BLE001
                db.rollback()
                print(f"[ocr-worker] analyze failed {doc.id}: {ana_exc}")

            # 要約を生成（Dify or ルールベース）。検索対象・要約PDF再利用のため保存する。
            summary = ""
            try:
                summary = summarize.summarize(text)
            except Exception as sum_exc:  # noqa: BLE001
                print(f"[ocr-worker] summarize failed {doc.id}: {sum_exc}")

            # タグを索引へ含める (F-17/F-24)
            tags = list(
                db.scalars(
                    select(DocumentTag.tag).where(DocumentTag.document_id == doc.id)
                ).all()
            )

            # 検索索引へ登録（OCR本文 + 要約 + タグ + メタデータ, F-23〜F-26）
            search.index_document(
                str(doc.id),
                {
                    "title": doc.title,
                    "ocr_text": text,
                    "summary": summary,
                    "tags": tags,
                    "category": doc.category,
                    "document_type": doc.document_type,
                    "owner_id": str(doc.owner_id),
                    "tenant_id": str(doc.tenant_id) if doc.tenant_id else None,
                    "created_at": doc.created_at.isoformat(),
                },
            )

            # 成果物の保存（OCR成功済みのため失敗してもステータスは落とさない）
            try:
                storage.put_object(
                    doc.storage_location, document_pdf_key(doc), pdf_bytes, "application/pdf"
                )
                if summary:
                    storage.put_object(
                        doc.storage_location, f"{doc.id}/summary.txt",
                        summary.encode("utf-8"), "text/plain; charset=utf-8",
                    )
                if preview:
                    storage.put_object(
                        doc.storage_location, f"{doc.id}/preview.jpg", preview, "image/jpeg"
                    )
                storage.put_object(
                    doc.storage_location, f"{doc.id}/quality.json",
                    json.dumps(quality, ensure_ascii=False).encode(), "application/json",
                )
                print(f"[ocr-worker] processed {doc.id} pages={quality.get('page_count')} "
                      f"warnings={quality.get('warnings')}")
            except Exception as art_exc:  # noqa: BLE001
                print(f"[ocr-worker] artifact save failed {doc.id}: {art_exc}")
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            doc.ocr_status = OcrStatus.failed
            db.commit()
            print(f"[ocr-worker] failed {doc.id}: {exc}")
            # 文字を読めなくても「紙が届いた」ことは家族に知らせる
            if db.get(DocumentInsight, doc.id) is None:
                db.add(DocumentInsight(document_id=doc.id, keywords=[], reasons=["文字を読み取れませんでした"]))
                db.commit()

        # 家族へ初回通知（1書類1回。解析結果の重要度・期限を添える）
        try:
            family.notify_new_document(db, doc)
        except Exception as ntf_exc:  # noqa: BLE001
            db.rollback()
            print(f"[ocr-worker] notify failed {doc.id}: {ntf_exc}")
    finally:
        db.close()


def backfill_insights(limit: int = 20) -> None:
    """解析結果の無い処理済みドキュメント（機能追加前の既存分）を解析する。通知はしない。"""
    db = SessionLocal()
    try:
        has = select(DocumentInsight.document_id)
        docs = db.scalars(
            select(Document)
            .where(Document.ocr_status == OcrStatus.done, Document.id.not_in(has))
            .limit(limit)
        ).all()
        for doc in docs:
            family.apply_analysis(db, doc, doc.ocr_text)
            db.get(DocumentInsight, doc.id).notified = True
            db.commit()
        if docs:
            print(f"[ocr-worker] backfilled insights: {len(docs)}")
    finally:
        db.close()


def backfill_search_tenant(limit: int = 500) -> None:
    """テナント導入前に索引したドキュメントへ tenant_id を埋める（検索から漏れないように）。"""
    ids = search.ids_missing_tenant(limit)
    if not ids:
        return
    db = SessionLocal()
    try:
        parsed = []
        for i in ids:
            try:
                parsed.append(uuid.UUID(i))
            except ValueError:  # 索引に想定外のIDが入っていても止めない
                continue
        rows = db.execute(
            select(Document.id, Document.tenant_id).where(Document.id.in_(parsed))
        ).all()
        done = 0
        for doc_id, tenant_id in rows:
            if tenant_id:
                search.set_tenant([str(doc_id)], str(tenant_id))
                done += 1
        if done:
            print(f"[ocr-worker] backfilled search tenant: {done}")
    finally:
        db.close()


def send_reminders() -> None:
    db = SessionLocal()
    try:
        n = family.run_reminders(db)
        if n:
            print(f"[ocr-worker] reminders sent: {n}")
    finally:
        db.close()


def main() -> None:
    print("[ocr-worker] started")
    search.ensure_index()
    last_reminder = 0.0
    while True:
        process_pending()
        if time.time() - last_reminder >= REMINDER_INTERVAL_SEC:
            last_reminder = time.time()
            for job in (backfill_insights, backfill_search_tenant, send_reminders):
                try:
                    job()
                except Exception as exc:  # noqa: BLE001 - 定期処理の失敗で OCR を止めない
                    print(f"[ocr-worker] {job.__name__} failed: {type(exc).__name__}: {exc}")
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
