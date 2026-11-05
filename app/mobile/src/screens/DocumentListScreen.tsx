import { useCallback, useLayoutEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { listCategories, listDocuments, OCR_LABEL, type Category, type DocumentRead } from "../api/client";
import { AccountButton } from "../components/AccountButton";
import { DocThumb } from "../components/DocThumb";
import { categoryColor, categoryIconName } from "../categoryStyle";
import { CategoryChip, DeadlineChip, ImportanceBadge } from "../components/FamilyBadges";
import { colors, radius } from "../theme";

// 家に届いた紙の箱: 未読 / 重要 / 期限あり で見逃しを防ぐ（Web の一覧と同じ区分）
type Filter = "all" | "unread" | "important" | "deadline" | "read";
type ViewMode = "list" | "grid";

const FILTERS: { key: Filter; label: string; match: (d: DocumentRead) => boolean }[] = [
  { key: "all", label: "すべて", match: () => true },
  { key: "unread", label: "未読", match: (d) => !d.is_read },
  { key: "important", label: "重要", match: (d) => d.importance === "high" },
  { key: "deadline", label: "期限あり", match: (d) => !!d.deadline },
  { key: "read", label: "既読", match: (d) => d.is_read },
];

// ドキュメント一覧・閲覧 (F-21, F-22, F-32)
// 上から カテゴリ（折り返して全部見せる）→ 状態（等幅で1行）→ 一覧。幅の狭い端末でも横スクロールなし。
export function DocumentListScreen() {
  const navigation = useNavigation<any>();
  const [docs, setDocs] = useState<DocumentRead[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // カテゴリの絞り込み（"all" = すべて、"none" = 未分類、それ以外はカテゴリID）
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<ViewMode>("list");

  const load = useCallback(() => {
    setRefreshing(true);
    listDocuments()
      .then(setDocs)
      .catch(() => {})
      .finally(() => setRefreshing(false));
    listCategories().then(setCategories).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 一覧/サムネイルの切替はヘッダー右へ（絞り込みの幅を空けるため）
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.viewBtn}
            onPress={() => setView((v) => (v === "list" ? "grid" : "list"))}
            accessibilityLabel={view === "list" ? "サムネイル表示" : "一覧表示"}
          >
            <Ionicons name={view === "list" ? "grid-outline" : "list-outline"} size={21} color={colors.textMuted} />
          </TouchableOpacity>
          <AccountButton />
        </View>
      ),
    });
  }, [navigation, view]);

  const current = FILTERS.find((f) => f.key === filter)!;
  const inCategory = (d: DocumentRead) =>
    categoryFilter === "all" || (categoryFilter === "none" ? !d.category_id : d.category_id === categoryFilter);
  const shown = docs.filter((d) => current.match(d) && inCategory(d));
  const categoryTabs: { key: string; label: string; n: number; icon: string; tone: { fg: string; bg: string }; filled?: boolean }[] = [
    { key: "all", label: "すべて", n: 0, icon: "apps", tone: { fg: colors.primary, bg: colors.primarySoft } },
    ...categories.map((c) => ({
      key: c.id,
      label: c.name,
      n: docs.filter((d) => d.category_id === c.id).length,
      icon: categoryIconName(c.icon),
      tone: categoryColor(c.color),
    })),
    {
      key: "none",
      label: "未分類",
      n: docs.filter((d) => !d.category_id).length,
      icon: "folder-open-outline",
      tone: { fg: colors.textMuted, bg: colors.surfaceMuted },
    },
  ];
  const countOf = (f: (typeof FILTERS)[number]) => (f.key === "all" || f.key === "read" ? 0 : docs.filter(f.match).length);

  const open = (item: DocumentRead) =>
    navigation.navigate("Detail", { id: item.id, title: item.title });

  const empty = (
    <View style={styles.empty}>
      <Ionicons name="file-tray-outline" size={40} color={colors.textSubtle} />
      <Text style={styles.emptyText}>該当する紙がありません。</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* カテゴリ: アイコンつきのチップを折り返して全部見せる */}
      {categories.length > 0 && (
        <View style={styles.catWrap}>
          {categoryTabs.map((c) => {
            const active = categoryFilter === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.cat, active && { backgroundColor: c.tone.bg, borderColor: c.tone.fg }]}
                onPress={() => setCategoryFilter(c.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`カテゴリ ${c.label}${c.n > 0 ? ` ${c.n}件` : ""}`}
              >
                <View style={[styles.catIcon, { backgroundColor: active ? "#fff" : c.tone.bg }]}>
                  <Ionicons name={c.icon as any} size={14} color={c.tone.fg} />
                </View>
                <Text style={[styles.catText, active && { color: c.tone.fg }]} numberOfLines={1}>
                  {c.label}
                </Text>
                {c.n > 0 && <Text style={[styles.catCount, active && { color: c.tone.fg }]}>{c.n}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* 状態: 等幅のセグメントで1行に収める（件数は右上の小さなバッジ） */}
      <View style={styles.segment}>
        {FILTERS.map((f) => {
          const n = countOf(f);
          const active = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.segBtn, active && styles.segBtnActive]}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${f.label}${n > 0 ? ` ${n}件` : ""}`}
            >
              <Text
                style={[styles.segText, active && styles.segTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {f.label}
              </Text>
              {n > 0 && (
                <View style={[styles.segCount, active && styles.segCountActive]}>
                  <Text style={[styles.segCountText, active && styles.segCountTextActive]}>{n > 99 ? "99+" : n}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {view === "list" ? (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => open(item)}>
              <View>
                <DocThumb id={item.id} style={styles.rowThumb} />
                {!item.is_read && <View style={styles.rowUnread} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, !item.is_read && styles.titleUnread]} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.meta}>
                  <CategoryChip
                    name={item.category}
                    visibility={item.category_visibility}
                    icon={item.category_icon}
                    color={item.category_color}
                  />
                  <ImportanceBadge importance={item.importance} />
                  <DeadlineChip deadline={item.deadline} />
                  {item.family_total > 1 && (
                    <Text style={[styles.metaText, item.family_confirmed < item.family_total && styles.metaPending]}>
                      家族 {item.family_confirmed}/{item.family_total} 確認
                    </Text>
                  )}
                  {item.ocr_status !== "done" && (
                    <Text style={styles.metaText}>{OCR_LABEL[item.ocr_status] ?? item.ocr_status}</Text>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.border} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={empty}
        />
      ) : (
        <FlatList
          data={shown}
          key="grid"
          numColumns={2}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={{ gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.gridCell} onPress={() => open(item)}>
              <DocThumb id={item.id} style={styles.gridImg} />
              {!item.is_read && <View style={styles.gridUnread} />}
              {item.importance === "high" && (
                <View style={styles.gridImportant}>
                  <ImportanceBadge importance={item.importance} />
                </View>
              )}
              <Text numberOfLines={1} style={[styles.gridTitle, !item.is_read && styles.titleUnread]}>
                {item.title}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={empty}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  viewBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  catWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  cat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  catIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  catText: { color: colors.text, fontWeight: "600", fontSize: 13, flexShrink: 1 },
  catCount: { color: colors.textMuted, fontWeight: "700", fontSize: 12 },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 3,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  segBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 2, borderRadius: radius.sm, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
  segTextActive: { color: colors.primary, fontWeight: "700" },
  segCount: {
    position: "absolute",
    top: 1,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  segCountActive: { backgroundColor: colors.primary },
  segCountText: { fontSize: 10, fontWeight: "700", color: colors.textMuted },
  segCountTextActive: { color: "#fff" },
  listContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    marginBottom: 8,
  },
  rowThumb: { width: 48, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  rowUnread: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  title: { fontSize: 15, color: colors.text, lineHeight: 21 },
  titleUnread: { fontWeight: "700" },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  metaText: { fontSize: 12, color: colors.textMuted },
  metaPending: { color: colors.warning, fontWeight: "700" },
  empty: { alignItems: "center", marginTop: 80, gap: 10 },
  emptyText: { color: colors.textSubtle, fontSize: 14 },
  gridCell: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: 12, overflow: "hidden" },
  gridImg: { width: "100%", height: 160, backgroundColor: colors.surfaceMuted },
  gridTitle: { fontSize: 13, color: colors.text, paddingHorizontal: 10, paddingVertical: 10 },
  gridUnread: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: "#fff",
  },
  gridImportant: { position: "absolute", top: 8, left: 8 },
});
