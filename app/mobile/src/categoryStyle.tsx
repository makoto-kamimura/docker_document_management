import { View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// カテゴリのアイコンと色（Web の src/categoryStyle.tsx と同じ一覧・同じ色）。
// API にはアイコン名（Ionicons の名前から -outline を除いた形）と色の名前が入っている。

type IconName = keyof typeof Ionicons.glyphMap;

export const CATEGORY_ICON_KEYS = [
  "folder", "document-text", "newspaper", "megaphone", "mail", "shield-checkmark", "star",
  "medkit", "heart", "school", "book", "people", "home", "construct", "car", "airplane",
  "cash", "card", "receipt", "cart", "calendar", "briefcase", "gift", "restaurant",
  "basketball", "musical-notes", "paw", "leaf",
] as const;

export const CATEGORY_COLORS = {
  indigo: { fg: "#4f46e5", bg: "#eef2ff" },
  sky: { fg: "#0284c7", bg: "#e0f2fe" },
  emerald: { fg: "#059669", bg: "#d1fae5" },
  amber: { fg: "#b45309", bg: "#fef3c7" },
  orange: { fg: "#c2410c", bg: "#ffedd5" },
  rose: { fg: "#e11d48", bg: "#ffe4e6" },
  violet: { fg: "#7c3aed", bg: "#ede9fe" },
  slate: { fg: "#475569", bg: "#f1f5f9" },
} as const;

type ColorKey = keyof typeof CATEGORY_COLORS;

// 一覧にないアイコン名が来たら folder にする
export function categoryIconName(icon?: string | null, filled = false): IconName {
  const key = (CATEGORY_ICON_KEYS as readonly string[]).includes(icon ?? "") ? icon! : "folder";
  return (filled ? key : `${key}-outline`) as IconName;
}

export function categoryColor(color?: string | null): { fg: string; bg: string } {
  return CATEGORY_COLORS[(color ?? "") as ColorKey] ?? CATEGORY_COLORS.indigo;
}

// 丸い背景つきのカテゴリアイコン
export function CategoryIcon({
  icon,
  color,
  size = 28,
  style,
}: {
  icon?: string | null;
  color?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const c = categoryColor(color);
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
        style,
      ]}
    >
      <Ionicons name={categoryIconName(icon)} size={Math.round(size * 0.56)} color={c.fg} />
    </View>
  );
}
