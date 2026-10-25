import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  ACTION_LABEL,
  ACTIONS,
  addComment,
  apiErrorMessage,
  formatDateTime as fmtDateTime,
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
import { colors, radius } from "../theme";
import { DeadlineChip, ImportanceBadge } from "./FamilyBadges";

// 家族それぞれの状態表示: 対応状況 > 既読 > 未読
function memberState(m: FamilyMember): { text: string; tone: "ok" | "pending" | "info" } {
  if (m.action && m.action !== "seen") {
    return { text: ACTION_LABEL[m.action], tone: m.action === "later" ? "pending" : "info" };
  }
  if (m.confirmed) return { text: `確認済み${m.read_at ? ` ${fmtDateTime(m.action_at ?? m.read_at)}` : ""}`, tone: "ok" };
  return { text: "未読", tone: "pending" };
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

  if (!status) return <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} />;
  const ins = status.insight;
  const mine = status.members.find((m) => m.user_id === myId);
  const pending = status.members.filter((m) => !m.confirmed && m.user_id !== myId);
  const confirmed = status.members.filter((m) => m.confirmed).length;
  const canSend = busy === null && !!draft.trim();

  return (
    <View>
      {/* 解析結果: 重要度・期限・対象・キーワード */}
      {ins && (ins.importance === "high" || ins.deadline || ins.event_date || ins.audience || ins.keywords.length > 0) && (
        <View style={styles.card}>
          <View style={styles.chips}>
            <ImportanceBadge importance={ins.importance} />
            <DeadlineChip deadline={ins.deadline} />
            {ins.event_date && (
              <View style={styles.plainChip}>
                <Ionicons name="calendar-clear-outline" size={12} color={colors.textMuted} />
                <Text style={styles.plainChipText}>日程 {formatMonthDay(ins.event_date)}</Text>
              </View>
            )}
          </View>
          {ins.audience && (
            <View style={styles.line}>
              <Ionicons name="person-outline" size={14} color={colors.textMuted} />
              <Text style={styles.lineText}>対象：{ins.audience}</Text>
            </View>
          )}
          {ins.keywords.length > 0 && (
            <View style={styles.line}>
              <Ionicons name="pricetag-outline" size={14} color={colors.textMuted} />
              <Text style={styles.lineText}>{ins.keywords.join("・")}</Text>
            </View>
          )}
        </View>
      )}

      {/* 自分の対応 */}
      <Text style={styles.section}>あなたの対応</Text>
      <View style={styles.segment}>
        {ACTIONS.map((a) => {
          const active = mine?.action === a;
          return (
            <TouchableOpacity
              key={a}
              style={[styles.segBtn, active && styles.segBtnActive]}
              onPress={() => choose(a)}
              disabled={busy !== null}
            >
              <Text style={[styles.segText, active && styles.segTextActive]} numberOfLines={1}>
                {ACTION_LABEL[a]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 家族の確認状況 */}
      <View style={styles.cardHead}>
        <Text style={styles.section}>家族の確認状況</Text>
        {status.all_confirmed ? (
          <View style={styles.doneChip}>
            <Ionicons name="checkmark-circle" size={13} color={colors.success} />
            <Text style={styles.doneChipText}>全員確認済み</Text>
          </View>
        ) : (
          <Text style={styles.sectionCount}>{confirmed}/{status.members.length}</Text>
        )}
      </View>
      <View style={styles.card}>
        {status.members.map((m, i) => {
          const st = memberState(m);
          const canPing = !m.confirmed && m.user_id !== myId;
          return (
            <View key={m.user_id} style={[styles.memberRow, i > 0 && styles.rowBorder]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{m.name.trim()[0] ?? "?"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.name}{m.user_id === myId ? "（あなた）" : ""}
                  </Text>
                  {m.is_owner && <Ionicons name="camera-outline" size={13} color={colors.textSubtle} />}
                </View>
                <Text style={[styles.memberState, styles[st.tone]]}>{st.text}</Text>
              </View>
              {canPing && (
                <TouchableOpacity style={styles.pingBtn} onPress={() => renotify(m)} disabled={busy !== null}>
                  <Ionicons name="notifications-outline" size={14} color={colors.warning} />
                  <Text style={styles.pingText}>通知</Text>
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
      <Text style={styles.section}>コメント{comments.length > 0 ? `（${comments.length}）` : ""}</Text>
      <View style={styles.card}>
        {comments.map((c, i) => (
          <View key={c.id} style={[styles.comment, i > 0 && styles.rowBorder]}>
            <Text style={styles.commentHead}>
              {c.user_name}  <Text style={styles.commentAt}>{fmtDateTime(c.created_at)}</Text>
            </Text>
            <Text style={styles.commentBody}>{c.body}</Text>
          </View>
        ))}
        <View style={[styles.commentForm, comments.length > 0 && styles.rowBorder]}>
          <TextInput
            style={styles.commentInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="家族へのメモ（例: 出欠票は提出済み）"
            placeholderTextColor={colors.textSubtle}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, !canSend && { opacity: 0.4 }]}
            onPress={send}
            disabled={!canSend}
            accessibilityLabel="送信"
          >
            <Ionicons name="paper-plane" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 10, paddingBottom: 6 },
  plainChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  plainChipText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  line: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  lineText: { flex: 1, color: colors.text, fontSize: 13 },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginBottom: 8 },
  sectionCount: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginBottom: 8 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  doneChip: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  doneChipText: { fontSize: 12, fontWeight: "700", color: colors.success },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 3, marginBottom: 20 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
  segTextActive: { color: colors.primary, fontWeight: "700" },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  memberName: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  memberState: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  ok: { color: colors.success },
  pending: { color: colors.warning },
  info: { color: colors.primary },
  pingBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.warningSoft },
  pingText: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  notifyAll: { marginVertical: 10, backgroundColor: colors.warningSoft, borderRadius: radius.md, paddingVertical: 11, alignItems: "center" },
  notifyAllText: { color: colors.warning, fontWeight: "700" },
  comment: { paddingVertical: 10 },
  commentHead: { fontSize: 12, fontWeight: "700", color: colors.text },
  commentAt: { fontWeight: "400", color: colors.textSubtle },
  commentBody: { fontSize: 14, color: colors.text, marginTop: 3, lineHeight: 20 },
  commentForm: { flexDirection: "row", gap: 8, paddingVertical: 10, alignItems: "flex-end" },
  commentInput: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 14,
    minHeight: 38,
    color: colors.text,
  },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
