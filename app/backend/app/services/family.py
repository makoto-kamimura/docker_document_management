"""家族での紙の共有・通知（撮影 → OCR → 解析 → 通知 → 家族で確認 → 対応状況の共有）。

- 家族 = ドキュメント所有者と同じグループのメンバー + 個別に共有されたユーザー（所有者を含む）
- 確認済み = 開いた（既読）か「確認した/対応する/対応済み」を選んだ人。「あとで確認」は未確認扱い
- 通知は未確認の家族にだけ送り、全員が確認したらリマインドは止まる
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import co_member_user_ids
from app.core.config import settings
from app.models.document import Document, OcrStatus
from app.models.document_permission import DocumentPermission
from app.models.family import (
    ActionStatus, DocumentAction, DocumentInsight, Notification, NotificationKind,
)
from app.models.read_receipt import DocumentReadReceipt
from app.models.user import User
from app.services import analyze, push

IMPORTANCE_LABEL = {"high": "重要", "normal": "通常", "low": "低"}


def today() -> date:
    return datetime.now(timezone(timedelta(hours=settings.tz_offset_hours))).date()


def fmt_date(d: date | None) -> str:
    return f"{d.month}/{d.day}" if d else ""


def is_confirmed(read_at: datetime | None, action: ActionStatus | None) -> bool:
    if action is not None:
        return action != ActionStatus.later
    return read_at is not None


# ---- 家族メンバー ----


def family_ids_map(db: Session, docs: list[Document]) -> dict:
    """{document_id: [user_id, ...]}（所有者を先頭に、グループの同居メンバーと個別共有先）。"""
    if not docs:
        return {}
    co: dict = {}
    for owner in {d.owner_id for d in docs}:
        co[owner] = [owner] + [u for u in co_member_user_ids(db, owner) if u != owner]
    grants: dict = {}
    for doc_id, user_id in db.execute(
        select(DocumentPermission.document_id, DocumentPermission.user_id).where(
            DocumentPermission.document_id.in_([d.id for d in docs])
        )
    ).all():
        grants.setdefault(doc_id, []).append(user_id)
    out = {}
    for d in docs:
        ids = list(co[d.owner_id])
        ids += [u for u in grants.get(d.id, []) if u not in ids]
        out[d.id] = ids
    # テナントをまたぐ相手は家族に含めない（移行前のデータが残っていた場合の保険）
    everyone = {u for ids in out.values() for u in ids}
    tenant_of = dict(
        db.execute(select(User.id, User.tenant_id).where(User.id.in_(everyone))).all()
    ) if everyone else {}
    return {
        d.id: [u for u in out[d.id] if tenant_of.get(u) == d.tenant_id] for d in docs
    }


def status_maps(db: Session, doc_ids: list) -> tuple[dict, dict]:
    """(既読 {(doc, user): read_at}, 対応 {(doc, user): DocumentAction})。"""
    if not doc_ids:
        return {}, {}
    reads = {
        (r.document_id, r.user_id): r.read_at
        for r in db.scalars(
            select(DocumentReadReceipt).where(DocumentReadReceipt.document_id.in_(doc_ids))
        ).all()
    }
    actions = {
        (a.document_id, a.user_id): a
        for a in db.scalars(select(DocumentAction).where(DocumentAction.document_id.in_(doc_ids))).all()
    }
    return reads, actions


def member_statuses(db: Session, doc: Document) -> list[dict]:
    """家族それぞれの 既読日時・対応状況・確認済みか。"""
    ids = family_ids_map(db, [doc])[doc.id]
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids))).all()}
    reads, actions = status_maps(db, [doc.id])
    rows = []
    for uid in ids:
        u = users.get(uid)
        if u is None:
            continue
        read_at = reads.get((doc.id, uid))
        act = actions.get((doc.id, uid))
        rows.append({
            "user_id": uid,
            "name": u.name,
            "is_owner": uid == doc.owner_id,
            "read_at": read_at,
            "action": act.status if act else None,
            "action_at": act.updated_at if act else None,
            "confirmed": is_confirmed(read_at, act.status if act else None),
        })
    return rows


# ---- 文書解析の反映 ----


def apply_analysis(db: Session, doc: Document, text: str | None) -> DocumentInsight:
    """OCR テキストを解析して DocumentInsight を保存する（利用者が修正済みなら上書きしない）。

    自動命名のタイトル（資料_123…）は見出し候補に、未設定のカテゴリは推定分類に置き換える。
    """
    ins = db.get(DocumentInsight, doc.id)
    if ins is None:
        ins = DocumentInsight(document_id=doc.id, keywords=[], reasons=[])
        db.add(ins)
    ref = (doc.created_at.astimezone(timezone(timedelta(hours=settings.tz_offset_hours))).date()
           if doc.created_at else today())
    result = analyze.analyze(text or "", ref)
    if not ins.manual:
        ins.importance = result.importance
        ins.deadline = result.deadline
        ins.event_date = result.event_date
        ins.audience = result.audience
        ins.keywords = result.keywords
        ins.reasons = result.reasons
    if result.title and analyze.AUTO_TITLE_RE.match(doc.title or ""):
        doc.title = result.title[:255]
    if result.category and not doc.category:
        doc.category = result.category
    db.commit()
    return ins


# ---- 通知 ----


def notify(
    db: Session,
    user_ids: list,
    doc: Document | None,
    kind: NotificationKind,
    title: str,
    body: str = "",
    actor_id=None,
    important: bool = False,
) -> int:
    """アプリ内通知を作り、プッシュも送る（ベストエフォート）。送った人数を返す。

    通知はドキュメントのテナントに属させる（受信者が別テナントへ移っても持ち越さない）。
    """
    targets = [u for u in dict.fromkeys(user_ids) if u != actor_id]
    if not targets:
        return 0
    for uid in targets:
        db.add(Notification(
            user_id=uid, document_id=doc.id if doc else None, kind=kind,
            tenant_id=doc.tenant_id if doc else None,
            title=title[:200], body=body[:500], actor_id=actor_id,
        ))
    db.commit()
    push.send(db, targets, kind, important, {"document_id": str(doc.id) if doc else None})
    return len(targets)


def _summary_line(ins: DocumentInsight | None) -> str:
    """通知本文の要約（期限・対象・キーワード）。"""
    if ins is None:
        return ""
    parts = []
    if ins.deadline:
        parts.append(f"期限 {fmt_date(ins.deadline)}")
    if ins.event_date:
        parts.append(f"日程 {fmt_date(ins.event_date)}")
    if ins.audience:
        parts.append(f"対象 {ins.audience}")
    kws = [k for k in (ins.keywords or []) if k != "重要"]
    if kws:
        parts.append("・".join(kws[:3]))
    return " / ".join(parts)


def notify_new_document(db: Session, doc: Document) -> int:
    """取り込み完了を家族に知らせる（1書類につき1回）。"""
    ins = db.get(DocumentInsight, doc.id)
    if ins is None or ins.notified:
        return 0
    ins.notified = True
    db.commit()
    owner = db.get(User, doc.owner_id)
    important = ins.importance == "high"
    title = ("🔴 " if important else "") + doc.title
    body = _summary_line(ins)
    if owner:
        body = (body + " — " if body else "") + f"{owner.name}さんが登録"
    ids = family_ids_map(db, [doc])[doc.id]
    return notify(db, ids, doc, NotificationKind.new_document, title, body,
                  actor_id=doc.owner_id, important=important)


def unconfirmed_ids(db: Session, doc: Document) -> list:
    return [m["user_id"] for m in member_statuses(db, doc) if not m["confirmed"]]


def renotify(db: Session, doc: Document, actor: User, user_id: uuid.UUID | None) -> int:
    """「もう一度通知」: 指定した家族（未指定なら未確認の全員）へ確認をお願いする。"""
    targets = [user_id] if user_id else unconfirmed_ids(db, doc)
    since = datetime.now(timezone.utc) - timedelta(minutes=settings.renotify_cooldown_minutes)
    recent = set(db.scalars(
        select(Notification.user_id).where(
            Notification.document_id == doc.id,
            Notification.kind == NotificationKind.renotify,
            Notification.created_at >= since,
        )
    ).all())
    targets = [u for u in targets if u not in recent and u != actor.id]
    ins = db.get(DocumentInsight, doc.id)
    return notify(
        db, targets, doc, NotificationKind.renotify,
        f"{actor.name}さんから確認のお願い: {doc.title}", _summary_line(ins),
        actor_id=actor.id, important=bool(ins and ins.importance == "high"),
    )


def notify_comment(db: Session, doc: Document, actor: User, body: str) -> int:
    ids = family_ids_map(db, [doc])[doc.id]
    return notify(db, ids, doc, NotificationKind.comment,
                  f"{actor.name}さんがコメント: {doc.title}", body[:120], actor_id=actor.id)


def run_reminders(db: Session) -> int:
    """定期実行: 未確認の家族へのリマインドと、期限前の通知を送る。送った件数を返す。

    - 対象: 重要 or 期限つきで、初回通知済み・期限切れでない書類
    - リマインド: 未確認の人に reminder_interval_hours ごと、最大 reminder_max_count 回（全員確認で終了）
    - 期限通知: 期限の deadline_notice_days 日前以降に1回。「対応する」を選んだ人がいればその人へ、
      誰かが「対応済み」なら送らない、どちらも無ければ家族全員へ
    """
    now = datetime.now(timezone.utc)
    t = today()
    rows = db.execute(
        select(Document, DocumentInsight)
        .join(DocumentInsight, DocumentInsight.document_id == Document.id)
        .where(
            Document.ocr_status == OcrStatus.done,
            DocumentInsight.notified.is_(True),
            (DocumentInsight.importance == "high") | (DocumentInsight.deadline.is_not(None)),
            (DocumentInsight.deadline.is_(None)) | (DocumentInsight.deadline >= t),
        )
    ).all()
    sent = 0
    for doc, ins in rows:
        members = member_statuses(db, doc)
        # 受信者ごとの通知履歴
        hist = db.execute(
            select(Notification.user_id, Notification.kind, func.count(), func.max(Notification.created_at))
            .where(Notification.document_id == doc.id)
            .group_by(Notification.user_id, Notification.kind)
        ).all()
        count = {(u, k): c for u, k, c, _ in hist}
        last: dict = {}
        for u, _k, _c, at in hist:
            last[u] = max(last.get(u, at), at)
        important = ins.importance == "high"

        due = [
            m["user_id"] for m in members
            if not m["confirmed"]
            and count.get((m["user_id"], NotificationKind.reminder), 0) < settings.reminder_max_count
            and (last.get(m["user_id"]) is None
                 or now - last[m["user_id"]] >= timedelta(hours=settings.reminder_interval_hours))
        ]
        if due:
            sent += notify(db, due, doc, NotificationKind.reminder, f"未確認: {doc.title}",
                           _summary_line(ins) or "確認をお願いします", important=important)

        if ins.deadline and (ins.deadline - t).days <= settings.deadline_notice_days:
            if any(m["action"] == ActionStatus.done for m in members):
                continue
            doers = [m["user_id"] for m in members if m["action"] == ActionStatus.will_do]
            targets = [u for u in (doers or [m["user_id"] for m in members])
                       if count.get((u, NotificationKind.deadline), 0) == 0]
            left = (ins.deadline - t).days
            sent += notify(db, targets, doc, NotificationKind.deadline,
                           f"📅 期限が近づいています: {doc.title}",
                           f"期限 {fmt_date(ins.deadline)}（{'今日' if left == 0 else f'あと{left}日'}）",
                           important=True)
    return sent
