import { Text, StyleSheet } from "react-native";
import { daysUntil, formatMonthDay, type Importance } from "../api/client";

// 🔴 重要 バッジ（重要度 high のときだけ表示）
export function ImportanceBadge({ importance }: { importance: Importance | null }) {
  if (importance !== "high") return null;
  return <Text style={[styles.chip, styles.important]}>🔴 重要</Text>;
}

// 📅 期限チップ。3日以内は赤、過ぎたものは灰色
export function DeadlineChip({ deadline, prefix = "期限" }: { deadline: string | null; prefix?: string }) {
  if (!deadline) return null;
  const left = daysUntil(deadline);
  const tone = left < 0 ? styles.past : left <= 3 ? styles.soon : styles.normal;
  const suffix = left < 0 ? "（期限切れ）" : left === 0 ? "（今日）" : left <= 3 ? `（あと${left}日）` : "";
  return <Text style={[styles.chip, tone]}>📅 {prefix} {formatMonthDay(deadline)}{suffix}</Text>;
}

const styles = StyleSheet.create({
  chip: { fontSize: 12, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  important: { backgroundColor: "#fee2e2", color: "#b91c1c" },
  soon: { backgroundColor: "#fee2e2", color: "#b91c1c" },
  normal: { backgroundColor: "#e0f2fe", color: "#0369a1" },
  past: { backgroundColor: "#f1f5f9", color: "#64748b" },
});
