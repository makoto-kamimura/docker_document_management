import type { CSSProperties } from "react";
import type { IconType } from "react-icons";
import {
  IoAirplaneOutline,
  IoAppsOutline,
  IoBasketballOutline,
  IoBookOutline,
  IoBriefcaseOutline,
  IoCalendarOutline,
  IoCarOutline,
  IoCardOutline,
  IoCartOutline,
  IoCashOutline,
  IoConstructOutline,
  IoDocumentTextOutline,
  IoFolderOutline,
  IoGiftOutline,
  IoHeartOutline,
  IoHomeOutline,
  IoLeafOutline,
  IoMailOutline,
  IoMedkitOutline,
  IoMegaphoneOutline,
  IoMusicalNotesOutline,
  IoNewspaperOutline,
  IoPawOutline,
  IoPeopleOutline,
  IoReceiptOutline,
  IoRestaurantOutline,
  IoSchoolOutline,
  IoShieldCheckmarkOutline,
  IoStarOutline,
} from "react-icons/io5";

// カテゴリのアイコンと色（モバイルの src/categoryStyle.tsx と同じ一覧・同じ色）。
// API にはアイコン名（Ionicons の名前から -outline を除いた形）と色の名前を保存する。

export const CATEGORY_ICONS: { key: string; Icon: IconType }[] = [
  { key: "folder", Icon: IoFolderOutline },
  { key: "document-text", Icon: IoDocumentTextOutline },
  { key: "newspaper", Icon: IoNewspaperOutline },
  { key: "megaphone", Icon: IoMegaphoneOutline },
  { key: "mail", Icon: IoMailOutline },
  { key: "shield-checkmark", Icon: IoShieldCheckmarkOutline },
  { key: "star", Icon: IoStarOutline },
  { key: "medkit", Icon: IoMedkitOutline },
  { key: "heart", Icon: IoHeartOutline },
  { key: "school", Icon: IoSchoolOutline },
  { key: "book", Icon: IoBookOutline },
  { key: "people", Icon: IoPeopleOutline },
  { key: "home", Icon: IoHomeOutline },
  { key: "construct", Icon: IoConstructOutline },
  { key: "car", Icon: IoCarOutline },
  { key: "airplane", Icon: IoAirplaneOutline },
  { key: "cash", Icon: IoCashOutline },
  { key: "card", Icon: IoCardOutline },
  { key: "receipt", Icon: IoReceiptOutline },
  { key: "cart", Icon: IoCartOutline },
  { key: "calendar", Icon: IoCalendarOutline },
  { key: "briefcase", Icon: IoBriefcaseOutline },
  { key: "gift", Icon: IoGiftOutline },
  { key: "restaurant", Icon: IoRestaurantOutline },
  { key: "basketball", Icon: IoBasketballOutline },
  { key: "musical-notes", Icon: IoMusicalNotesOutline },
  { key: "paw", Icon: IoPawOutline },
  { key: "leaf", Icon: IoLeafOutline },
];

export type CategoryColor = "slate" | "indigo" | "sky" | "emerald" | "amber" | "orange" | "rose" | "violet";

export const CATEGORY_COLORS: { key: CategoryColor; label: string; fg: string; bg: string }[] = [
  { key: "indigo", label: "あい", fg: "#4f46e5", bg: "#eef2ff" },
  { key: "sky", label: "そら", fg: "#0284c7", bg: "#e0f2fe" },
  { key: "emerald", label: "みどり", fg: "#059669", bg: "#d1fae5" },
  { key: "amber", label: "きいろ", fg: "#b45309", bg: "#fef3c7" },
  { key: "orange", label: "だいだい", fg: "#c2410c", bg: "#ffedd5" },
  { key: "rose", label: "あか", fg: "#e11d48", bg: "#ffe4e6" },
  { key: "violet", label: "むらさき", fg: "#7c3aed", bg: "#ede9fe" },
  { key: "slate", label: "グレー", fg: "#475569", bg: "#f1f5f9" },
];

export const DEFAULT_ICON = "folder";
export const DEFAULT_COLOR: CategoryColor = "indigo";

export function categoryIcon(key?: string | null): IconType {
  return CATEGORY_ICONS.find((i) => i.key === key)?.Icon ?? IoFolderOutline;
}

export function categoryColor(key?: string | null) {
  return CATEGORY_COLORS.find((c) => c.key === key) ?? CATEGORY_COLORS[0];
}

// 「すべて」「未分類」の絞り込み用のアイコン
export const ALL_ICON = IoAppsOutline;

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
  style?: CSSProperties;
}) {
  const Icon = categoryIcon(icon);
  const c = categoryColor(color);
  return (
    <span
      className="cat-icon"
      style={{ width: size, height: size, background: c.bg, color: c.fg, fontSize: size * 0.55, ...style }}
      aria-hidden
    >
      <Icon />
    </span>
  );
}
