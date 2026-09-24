import { useCallback, useEffect, useState } from "react";
import {
  ACTION_LABEL,
  ACTIONS,
  addComment,
  apiErrorMessage,
  daysUntil,
  formatMonthDay,
  getFamilyStatus,
  listComments,
  notifyFamily,
  setMyAction,
  type ActionStatus,
  type Comment,
  type FamilyMember,
  type FamilyStatus,
  type Importance,
} from "../api/client";
import { useMe } from "../me";

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// 🔴 重要 バッジ（重要度 high のときだけ）
export function ImportanceBadge({ importance }: { importance: Importance | null }) {
  if (importance !== "high") return null;
  return <span className="chip chip-important">🔴 重要</span>;
}

// 📅 期限チップ。3日以内は赤、過ぎたものは灰色（モバイルと同じ）
export function DeadlineChip({ deadline }: { deadline: string | null }) {
  if (!deadline) return null;
  const left = daysUntil(deadline);
  const cls = left < 0 ? "chip-deadline past" : left <= 3 ? "chip-deadline soon" : "chip-deadline";
  const suffix = left < 0 ? "（期限切れ）" : left === 0 ? "（今日）" : left <= 3 ? `（あと${left}日）` : "";
  return <span className={`chip ${cls}`}>📅 期限 {formatMonthDay(deadline)}{suffix}</span>;
}

// 家族それぞれの状態表示: 対応状況 > 既読 > 未読（モバイルと同じ）
function memberState(m: FamilyMember): { text: string; cls: string } {
  if (m.action && m.action !== "seen") {
    return { text: ACTION_LABEL[m.action], cls: m.action === "later" ? "state-pending" : "state-info" };
  }
  if (m.confirmed) {
    const at = m.action_at ?? m.read_at;
    return { text: `✓ 確認済み${at ? ` ${fmtDateTime(at)}` : ""}`, cls: "state-ok" };
  }
  return { text: "○ 未読", cls: "state-pending" };
}

// 書類の「家族」パネル: 重要度・期限 / 自分の対応 / 家族の確認状況と再通知 / コメント
export function FamilyPanel({ docId, onChanged }: { docId: string; onChanged?: () => void }) {
  const { me } = useMe();
  const [status, setStatus] = useState<FamilyStatus | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    getFamilyStatus(docId).then(setStatus).catch(() => setMessage("家族の確認状況を取得できませんでした。"));
    listComments(docId).then(setComments).catch(() => {});
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  async function choose(action: ActionStatus) {
    setBusy(action);
    try {
      setStatus(await setMyAction(docId, action));
      onChanged?.();
    } catch (e) {
      setMessage(apiErrorMessage(e, "対応状況を保存できませんでした。"));
    } finally {
      setBusy(null);
    }
  }

  async function renotify(member?: FamilyMember) {
    setBusy(member ? member.user_id : "all");
    try {
      const sent = await notifyFamily(docId, member?.user_id);
      setMessage(
        sent > 0
          ? member ? `${member.name}さんにもう一度知らせました。` : `${sent}人に知らせました。`
          : "少し前に通知済みのため送りませんでした。"
      );
    } catch (e) {
      setMessage(apiErrorMessage(e, "通知できませんでした。"));
    } finally {
      setBusy(null);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy("comment");
    try {
      const c = await addComment(docId, body);
      setComments((prev) => [...prev, c]);
      setDraft("");
    } catch (err) {
      setMessage(apiErrorMessage(err, "コメントを送れませんでした。"));
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return message ? <div className="login-error">{message}</div> : <div className="state"><div className="spinner" /></div>;
  }
  const ins = status.insight;
  const myId = me?.id;
  const mine = status.members.find((m) => m.user_id === myId);
  const pending = status.members.filter((m) => !m.confirmed && m.user_id !== myId);

  return (
    <div className="family-panel">
      {message && <div className="family-message">{message}</div>}

      {ins && (
        <div className="family-insight">
          <div className="chips">
            <ImportanceBadge importance={ins.importance} />
            <DeadlineChip deadline={ins.deadline} />
            {ins.event_date && <span className="chip">🗓 日程 {formatMonthDay(ins.event_date)}</span>}
            {ins.manual && <span className="chip">手動で修正済み</span>}
          </div>
          {ins.audience && <div className="family-line">👤 対象：{ins.audience}</div>}
          {ins.keywords.length > 0 && <div className="family-line">🏷 {ins.keywords.join("・")}</div>}
        </div>
      )}

      <div className="section-title">あなたの対応</div>
      <div className="fam-actions">
        {ACTIONS.map((a) => (
          <button
            key={a}
            className={"seg-btn" + (mine?.action === a ? " active" : "")}
            onClick={() => choose(a)}
            disabled={busy !== null}
          >
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>

      <div className="section-title">
        家族の確認状況（{status.members.filter((m) => m.confirmed).length}/{status.members.length}）
        {status.all_confirmed && <span className="state-ok">　全員確認済み</span>}
      </div>
      <div className="acl-list">
        {status.members.map((m) => {
          const st = memberState(m);
          return (
            <div className="acl-row" key={m.user_id}>
              <div className="acl-user">
                <strong>
                  {m.name}
                  {m.user_id === myId ? "（あなた）" : ""}
                  {m.is_owner ? " 📷" : ""}
                </strong>
                <span className={st.cls}>{st.text}</span>
              </div>
              {!m.confirmed && m.user_id !== myId && (
                <button className="btn btn-sm" onClick={() => renotify(m)} disabled={busy !== null}>
                  もう一度通知
                </button>
              )}
            </div>
          );
        })}
      </div>
      {pending.length > 1 && (
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => renotify()} disabled={busy !== null}>
          未確認の家族全員に知らせる（{pending.length}人）
        </button>
      )}

      <div className="section-title" style={{ marginTop: 16 }}>コメント（{comments.length}）</div>
      <div className="comments">
        {comments.map((c) => (
          <div className="comment" key={c.id}>
            <div className="comment-head">
              <strong>{c.user_name}</strong> <span>{fmtDateTime(c.created_at)}</span>
            </div>
            <div className="comment-body">{c.body}</div>
          </div>
        ))}
      </div>
      <form className="comment-form" onSubmit={send}>
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="家族へのメモ（例: 出欠票は提出済み）"
          maxLength={1000}
        />
        <button type="submit" className="btn btn-primary" disabled={busy !== null || !draft.trim()}>
          送信
        </button>
      </form>
    </div>
  );
}

// 一覧・通知から開く「家族・対応」モーダル
export function FamilyModal({
  doc,
  onClose,
}: {
  doc: { id: string; title: string };
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>家族・対応</h2>
        <p style={{ color: "var(--text-muted)", marginTop: -4 }}>{doc.title}</p>
        <FamilyPanel docId={doc.id} />
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
