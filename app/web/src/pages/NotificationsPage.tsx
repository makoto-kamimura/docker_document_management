import { useEffect, useState } from "react";
import {
  getDocument,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationKind,
} from "../api/client";
import { FamilyModal } from "../components/FamilyPanel";
import { ViewerModal } from "../components/DocViewer";

const KIND_ICON: Record<NotificationKind, string> = {
  new_document: "📄",
  reminder: "⏰",
  renotify: "🔔",
  deadline: "📅",
  comment: "💬",
};

function ago(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}時間前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

// 家族からのお知らせ一覧（新しい紙・リマインド・再通知・期限・コメント。モバイルと同じ）
export function NotificationsPage({ onRead }: { onRead: () => void }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [familyDoc, setFamilyDoc] = useState<{ id: string; title: string } | null>(null);
  const [viewerDoc, setViewerDoc] = useState<{ id: string; title: string } | null>(null);

  function load() {
    return listNotifications()
      .then(setItems)
      .catch(() => setError("お知らせを取得できませんでした。"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function open(n: AppNotification, target: "family" | "viewer") {
    if (!n.read_at) {
      markNotificationRead(n.id).then(onRead).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    if (!n.document_id) return;
    try {
      const d = await getDocument(n.document_id);
      (target === "family" ? setFamilyDoc : setViewerDoc)({ id: d.id, title: d.title });
    } catch {
      setError("この書類は削除されたか、閲覧権限がありません。");
    }
  }

  async function readAll() {
    await markAllNotificationsRead();
    await load();
    onRead();
  }

  if (loading) {
    return <div className="state"><div className="spinner" /><p>読み込み中…</p></div>;
  }

  return (
    <section>
      <div className="listbar">
        <div style={{ flex: 1 }} />
        {items.some((n) => !n.read_at) && (
          <button className="btn btn-sm" onClick={readAll}>すべて既読にする</button>
        )}
      </div>
      {error && <div className="login-error">{error}</div>}
      <div className="card table-wrap">
        {items.length === 0 ? (
          <div className="state">
            <div className="emoji">🔔</div>
            <h3>お知らせはありません</h3>
            <p>家族が紙を撮影すると、ここにお知らせが届きます。</p>
          </div>
        ) : (
          items.map((n) => (
            <div key={n.id} className={"notif-item" + (n.read_at ? "" : " unread")} onClick={() => open(n, "family")}>
              <div className="notif-icon">{KIND_ICON[n.kind] ?? "🔔"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="notif-title">{n.title}</div>
                {n.body && <div className="notif-body">{n.body}</div>}
                <div className="notif-at">{ago(n.created_at)}</div>
              </div>
              {n.document_id && (
                <button
                  className="btn btn-sm"
                  onClick={(e) => { e.stopPropagation(); open(n, "viewer"); }}
                >
                  紙を見る
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {familyDoc && <FamilyModal doc={familyDoc} onClose={() => setFamilyDoc(null)} />}
      {viewerDoc && <ViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </section>
  );
}
