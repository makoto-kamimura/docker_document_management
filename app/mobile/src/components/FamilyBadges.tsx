import { Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { daysUntil, formatMonthDay, type Importance } from "../api/client";
import { colors, radius } from "../theme";

// 「重要」バッジ（重要度 high のときだけ表示）
export function ImportanceBadge({ importance }: { importance: Importance | null }) {
  if (importance !== "high") return null;
  return (
    <View style={[styles.chip, { backgroundColor: colors.dangerSoft }]}>
      <View style={styles.dot} />
      <Text style={[styles.text, { color: colors.danger }]}>重要</Text>
    </View>
  );
}

// 期限チップ。3日以内は赤、過ぎたものは灰色
export function DeadlineChip({ deadline, prefix = "期限" }: { deadline: string | null; prefix?: string }) {
  if (!deadline) return null;
  const left = daysUntil(deadline);
  const tone = left < 0 ? tones.past : left <= 3 ? tones.soon : tones.normal;
  const suffix = left < 0 ? "（期限切れ）" : left === 0 ? "（今日）" : left <= 3 ? `（あと${left}日）` : "";
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <Ionicons name="calendar-outline" size={12} color={tone.fg} />
      <Text style={[styles.text, { color: tone.fg }]}>
        {prefix} {formatMonthDay(deadline)}
        {suffix}
      </Text>
    </View>
  );
}

const tones = {
  soon: { bg: colors.dangerSoft, fg: colors.danger },
  normal: { bg: "#e0f2fe", fg: "#0369a1" },
  past: { bg: colors.surfaceMuted, fg: colors.textMuted },
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  text: { fontSize: 12, fontWeight: "700" },
});
