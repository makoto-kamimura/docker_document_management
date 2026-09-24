"""Expo Push API によるプッシュ送信（ベストエフォート）。

プッシュは Expo → Apple/Google のサーバーを経由するため、書類の中身（タイトル・本文・期限など）は
載せず、種類ごとの定型文と document_id だけを送る。詳細はアプリ内通知で見る。
"""

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.family import NotificationKind, PushToken

# 種類ごとの定型文（中身を含めない）
PUSH_TEXT = {
    NotificationKind.new_document: "新しい紙が届きました",
    NotificationKind.reminder: "まだ確認していない紙があります",
    NotificationKind.renotify: "家族から確認のお願いが届きました",
    NotificationKind.deadline: "期限が近い紙があります",
    NotificationKind.comment: "紙にコメントが付きました",
}


def send(db: Session, user_ids: list, kind: NotificationKind, important: bool, data: dict) -> None:
    """user_ids の端末へプッシュを送る。失敗しても例外は投げない。"""
    if not settings.push_enabled or not user_ids:
        return
    tokens = db.scalars(select(PushToken.token).where(PushToken.user_id.in_(user_ids))).all()
    if not tokens:
        return
    title = ("🔴 " if important else "") + PUSH_TEXT.get(kind, "お知らせがあります")
    messages = [
        {"to": t, "title": title, "body": "アプリで内容を確認してください", "data": data, "sound": "default"}
        for t in tokens
    ]
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.expo_access_token:
        headers["Authorization"] = f"Bearer {settings.expo_access_token}"
    try:
        res = httpx.post(settings.expo_push_url, json=messages, headers=headers, timeout=5.0)
        tickets = res.json().get("data", [])
    except Exception as exc:  # noqa: BLE001 - 通知失敗で本処理を止めない
        print(f"[push] send failed: {type(exc).__name__}: {exc}")
        return
    # 端末がアンインストール等で無効になったトークンは削除する
    dead = [
        messages[i]["to"]
        for i, t in enumerate(tickets)
        if isinstance(t, dict) and t.get("details", {}).get("error") == "DeviceNotRegistered"
    ]
    if dead:
        db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
        db.commit()
