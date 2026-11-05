import { ScrollView, Text, TouchableOpacity, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Category } from "../api/client";
import { categoryColor, categoryIconName } from "../categoryStyle";
import { colors, radius } from "../theme";

// 登録するカテゴリを選ぶチップの横並び（null = 未分類）。
// 撮影画面（カメラの上なので dark）と確認画面（light）で同じ部品を使い、選択は引き継ぐ。
export function CategoryPicker({
  categories,
  value,
  onChange,
  variant = "light",
}: {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  variant?: "light" | "dark";
}) {
  const dark = variant === "dark";
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, dark && styles.rowDark]}
      keyboardShouldPersistTaps="handled"
    >
      {[null, ...categories].map((c) => {
        const active = (c?.id ?? null) === value;
        const tone = c ? categoryColor(c.color) : { fg: colors.textMuted, bg: colors.surfaceMuted };
        const fg = dark ? (active ? colors.text : "#fff") : active ? tone.fg : colors.textMuted;
        return (
          <TouchableOpacity
            key={c?.id ?? "none"}
            style={[
              styles.chip,
              dark ? styles.chipDark : null,
              active && (dark ? styles.chipDarkActive : { backgroundColor: tone.bg, borderColor: tone.fg }),
            ]}
            onPress={() => onChange(c?.id ?? null)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`カテゴリ ${c?.name ?? "未分類"}`}
          >
            {c ? (
              <View style={[styles.iconDot, { backgroundColor: dark && !active ? "rgba(255,255,255,0.18)" : tone.bg }]}>
                <Ionicons name={categoryIconName(c.icon)} size={13} color={dark && !active ? "#fff" : tone.fg} />
              </View>
            ) : (
              <Ionicons name="remove-circle-outline" size={16} color={fg} />
            )}
            <Text style={[styles.text, { color: fg }, active && styles.textActive]} numberOfLines={1}>
              {c?.name ?? "未分類"}
            </Text>
            {c?.visibility === "owner" && <Ionicons name="lock-closed" size={11} color={fg} />}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingRight: 8 },
  rowDark: { paddingHorizontal: 16 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: "transparent",
    maxWidth: 220,
  },
  chipDark: { backgroundColor: "rgba(255,255,255,0.14)" },
  chipDarkActive: { backgroundColor: "#fff" },
  iconDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  text: { fontWeight: "600", fontSize: 14, flexShrink: 1 },
  textActive: { fontWeight: "700" },
});
