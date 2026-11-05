import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ACTION_LABEL,
  ACTIONS,
  addComment,
  apiErrorMessage,
  setMyAction,
  type ActionStatus,
  type Comment,
} from "../api/client";
import { colors, radius } from "../theme";

type IconName = keyof typeof Ionicons.glyphMap;
const ACTION_ICON: Record<ActionStatus, { off: IconName; on: IconName }> = {
  seen: { off: "eye-outline", on: "eye" },
  will_do: { off: "flag-outline", on: "flag" },
  done: { off: "checkmark-done-circle-outline", on: "checkmark-done-circle" },
  later: { off: "time-outline", on: "time" },
};

// 書類詳細の下に固定する「コメント＋あなたの対応」。
// - ➤ はコメントだけを送り、画面に残る。
// - 対応のアイコンを押すと、入力中のコメントがあれば先に送り、対応を保存して一覧へ戻る（onDone）。
export function ActionBar({
  docId,
  current,
  onCommentAdded,
  onDone,
}: {
  docId: string;
  current: ActionStatus | null;
  onCommentAdded: (c: Comment) => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<ActionStatus | "comment" | null>(null);
  const body = draft.trim();

  async function sendComment() {
    if (!body) return;
    setBusy("comment");
    try {
      onCommentAdded(await addComment(docId, body));
      setDraft("");
    } catch (e) {
      Alert.alert("エラー", apiErrorMessage(e, "コメントを送れませんでした。"));
    } finally {
      setBusy(null);
    }
  }

  async function choose(action: ActionStatus) {
    setBusy(action);
    try {
      if (body) {
        onCommentAdded(await addComment(docId, body));
        setDraft("");
      }
      await setMyAction(docId, action);
      onDone();
    } catch (e) {
      Alert.alert("エラー", apiErrorMessage(e, "対応状況を保存できませんでした。"));
      setBusy(null);
    }
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.commentRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="家族へのメモ（例: 出欠票は提出済み）"
          placeholderTextColor={colors.textSubtle}
          multiline
          maxLength={1000}
          editable={busy === null}
        />
        <TouchableOpacity
          style={[styles.send, (!body || busy !== null) && { opacity: 0.4 }]}
          onPress={sendComment}
          disabled={!body || busy !== null}
          accessibilityLabel="コメントを送信"
        >
          {busy === "comment" ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="paper-plane" size={16} color="#fff" />}
        </TouchableOpacity>
      </View>

      <View style={styles.actions} accessibilityRole="radiogroup" accessibilityLabel="あなたの対応">
        {ACTIONS.map((a) => {
          const active = current === a;
          return (
            <TouchableOpacity
              key={a}
              style={[styles.action, active && styles.actionActive]}
              onPress={() => choose(a)}
              disabled={busy !== null}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: busy !== null }}
              accessibilityLabel={`${ACTION_LABEL[a]}${body ? "（コメントも送信）" : ""}して一覧へ戻る`}
            >
              {busy === a ? (
                <ActivityIndicator color={colors.primary} style={styles.iconSlot} />
              ) : (
                <Ionicons
                  name={active ? ACTION_ICON[a].on : ACTION_ICON[a].off}
                  size={24}
                  color={active ? colors.primary : colors.textMuted}
                  style={styles.iconSlot}
                />
              )}
              <Text style={[styles.actionText, active && styles.actionTextActive]} numberOfLines={1}>
                {ACTION_LABEL[a]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 6,
  },
  commentRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 14,
    minHeight: 38,
    maxHeight: 96, // 4行ほどで止めてスクロール
    color: colors.text,
  },
  send: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 4 },
  action: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: radius.md, gap: 2 },
  actionActive: { backgroundColor: colors.primarySoft },
  iconSlot: { height: 26 },
  actionText: { fontSize: 11, fontWeight: "600", color: colors.textMuted },
  actionTextActive: { color: colors.primary, fontWeight: "700" },
});
