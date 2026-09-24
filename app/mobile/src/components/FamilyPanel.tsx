import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import {
  ACTION_LABEL,
  ACTIONS,
  addComment,
  apiErrorMessage,
  formatMonthDay,
  getFamilyStatus,
  getMe,
  listComments,
  notifyFamily,
  setMyAction,
  type ActionStatus,
  type Comment,
  type FamilyMember,
  type FamilyStatus,
} from "../api/client";
import { DeadlineChip, ImportanceBadge } from "./FamilyBadges";

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 家族それぞれの状態表示: 対応状況 > 既読 > 未読
function memberState(m: FamilyMember): { text: string; tone: "ok" | "pending" | "info" } {
  if (m.action && m.action !== "seen") {
    return { text: ACTION_LABEL[m.action], tone: m.action === "later" ? "pending" : "info" };
  }
  if (m.confirmed) return { text: `✓ 確認済み${m.read_at ? ` ${fmtDateTime(m.action_at ?? m.read_at)}` : ""}`, tone: "ok" };
  return { text: "○ 未読", tone: "pending" };
}

// 書類詳細の「家族」パネル: 重要度・期限 / 自分の対応 / 家族の確認状況と再通知 / コメント（Web と同じ構成）
export function FamilyPanel({ docId, reloadKey }: { docId: string; reloadKey: number }) {
  const [status, setStatus] = useState<FamilyStatus | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    getFamilyStatus(docId).then(setStatus).catch(() => {});
    listComments(docId).then(setComments).catch(() => {});
  }, [docId]);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { getMe().then((u) => setMyId(u.id)).catch(() => {}); }, []);

  async function choose(action: ActionStatus) {
    setBusy(action);
    try {
      setStatus(await setMyAction(docId, action));
    } catch (e) {
      Alert.alert("エラー", apiErrorMessage(e, "対応状況を保存できませんでした。"));
    } finally {
      setBusy(null);
    }
  }

  async function renotify(member?: FamilyMember) {
    setBusy(member ? member.user_id : "all");
    try {
      const sent = await notifyFamily(docId, member?.user_id);
      Alert.alert(
        "通知",
        sent > 0
          ? member ? `${member.name}さんにもう一度知らせました。` : `${sent}人に知らせました。`
          : "少し前に通知済みのため送りませんでした。"
      );
    } catch (e) {
      Alert.alert("エラー", apiErrorMessage(e, "通知できませんでした。"));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy("comment");
    try {
      const c = await addComment(docId, body);
      setComments((prev) => [...prev, c]);
      setDraft("");
    } catch (e) {
      Alert.alert("エラー", apiErrorMessage(e, "コメントを送れませんでした。"));
    } finally {
      setBusy(null);
    }
  }

  if (!status) return <ActivityIndicator style={{ marginVertical: 16 }} color="#4f46e5" />;
  const ins = status.insight;
  const mine = status.members.find((m) => m.user_id === myId);
  const pending = status.members.filter((m) => !m.confirmed && m.user_id !== myId);

  return (
    <View>
      {/* 解析結果: 重要度・期限・対象・キーワード */}
      {ins && (
        <View style={styles.card}>
          <View style={styles.chips}>
            <ImportanceBadge importance={ins.importance} />
            <DeadlineChip deadline={ins.deadline} />
            {ins.event_date && <Text style={styles.plainChip}>🗓 日程 {formatMonthDay(ins.event_date)}</Text>}
          </View>
          {ins.audience && <Text style={styles.line}>👤 対象：{ins.audience}</Text>}
          {ins.keywords.length > 0 && (
            <Text style={styles.line}>🏷 {ins.keywords.join("・")}</Text>
          )}
        </View>
      )}

      {/* 自分の対応 */}
      <Text style={styles.section}>あなたの対応</Text>
      <View style={styles.actions}>
        {ACTIONS.map((a) => {
          const active = mine?.action === a;
          return (
            <TouchableOpacity
              key={a}
              style={[styles.actionBtn, active && styles.actionBtnActive]}
              onPress={() => choose(a)}
              disabled={busy !== null}
            >
              <Text style={[styles.actionText, active && styles.actionTextActive]}>{ACTION_LABEL[a]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 家族の確認状況 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          家族の確認状況（{status.members.filter((m) => m.confirmed).length}/{status.members.length}）
          {status.all_confirmed ? "  全員確認済み" : ""}
        </Text>
        {status.members.map((m) => {
          const st = memberState(m);
          const canPing = !m.confirmed && m.user_id !== myId;
          return (
            <View key={m.user_id} style={styles.memberRow}>
              <Text style={styles.memberName}>
                {m.name}{m.user_id === myId ? "（あなた）" : ""}{m.is_owner ? " 📷" : ""}
              </Text>
              <Text style={[styles.memberState, styles[st.tone]]}>{st.text}</Text>
              {canPing && (
                <TouchableOpacity style={styles.pingBtn} onPress={() => renotify(m)} disabled={busy !== null}>
                  <Text style={styles.pingText}>もう一度通知</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
        {pending.length > 1 && (
          <TouchableOpacity style={styles.notifyAll} onPress={() => renotify()} disabled={busy !== null}>
            <Text style={styles.notifyAllText}>未確認の家族全員に知らせる（{pending.length}人）</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* コメント */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>コメント（{comments.length}）</Text>
        {comments.map((c) => (
          <View key={c.id} style={styles.comment}>
            <Text style={styles.commentHead}>{c.user_name}  <Text style={styles.commentAt}>{fmtDateTime(c.created_at)}</Text></Text>
            <Text style={styles.commentBody}>{c.body}</Text>
          </View>
        ))}
        <View style={styles.commentForm}>
          <TextInput
            style={styles.commentInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="家族へのメモ（例: 出欠票は提出済み）"
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={busy !== null || !draft.trim()}>
            <Text style={styles.sendText}>送信</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  plainChip: { fontSize: 12, fontWeight: "700", color: "#475569", backgroundColor: "#f1f5f9", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  line: { color: "#334155", fontSize: 13, marginTop: 4 },
  section: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1" },
  actionBtnActive: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  actionText: { color: "#334155", fontWeight: "600", fontSize: 13 },
  actionTextActive: { color: "#fff" },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a", marginBottom: 8 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 8 },
  memberName: { flex: 1, color: "#0f172a", fontSize: 14 },
  memberState: { fontSize: 12, fontWeight: "700" },
  ok: { color: "#047857" },
  pending: { color: "#b45309" },
  info: { color: "#4f46e5" },
  pingBtn: { backgroundColor: "#fef3c7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  pingText: { color: "#92400e", fontSize: 12, fontWeight: "700" },
  notifyAll: { marginTop: 10, backgroundColor: "#f59e0b", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  notifyAllText: { color: "#fff", fontWeight: "700" },
  comment: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  commentHead: { fontSize: 12, fontWeight: "700", color: "#334155" },
  commentAt: { fontWeight: "400", color: "#94a3b8" },
  commentBody: { fontSize: 14, color: "#0f172a", marginTop: 2 },
  commentForm: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "flex-end" },
  commentInput: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, minHeight: 40 },
  sendBtn: { backgroundColor: "#4f46e5", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  sendText: { color: "#fff", fontWeight: "700" },
});
