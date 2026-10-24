import { useCallback, useState } from "react";
import { View, Text, FlatList, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { listDocuments, type DocumentRead } from "../api/client";
import { DocThumb } from "../components/DocThumb";
import { DeadlineChip, ImportanceBadge } from "../components/FamilyBadges";
import { colors, radius } from "../theme";

const OCR_LABEL: Record<string, string> = {
  done: "完了",
  processing: "読み取り中",
  pending: "待機中",
  failed: "失敗",
};

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
export function DocumentListScreen() {
  const navigation = useNavigation<any>();
  const [docs, setDocs] = useState<DocumentRead[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<ViewMode>("list");

  const load = useCallback(() => {
    setRefreshing(true);
    listDocuments()
      .then(setDocs)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const current = FILTERS.find((f) => f.key === filter)!;
  const shown = docs.filter(current.match);
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
      <View style={styles.tabsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {FILTERS.map((f) => {
            const n = countOf(f);
            const active = filter === f.key;
            return (
              <TouchableOpacity key={f.key} style={[styles.tab, active && styles.tabActive]} onPress={() => setFilter(f.key)}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{f.label}</Text>
                {n > 0 && (
                  <View style={[styles.count, active && styles.countActive]}>
                    <Text style={[styles.countText, active && styles.countTextActive]}>{n}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* 一覧/サムネイル 切替 */}
        <TouchableOpacity
          style={styles.viewBtn}
          onPress={() => setView(view === "list" ? "grid" : "list")}
          accessibilityLabel={view === "list" ? "サムネイル表示" : "一覧表示"}
        >
          <Ionicons name={view === "list" ? "grid-outline" : "list-outline"} size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {view === "list" ? (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => open(item)}>
              <View style={[styles.unreadDot, item.is_read && { backgroundColor: "transparent" }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, !item.is_read && styles.titleUnread]} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.meta}>
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
  tabsRow: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 8, paddingVertical: 8 },
  tabs: { gap: 8, paddingRight: 8 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  tabActive: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: colors.primary },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
  countActive: { backgroundColor: colors.primary },
  countText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  countTextActive: { color: "#fff" },
  viewBtn: { width: 38, height: 34, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    marginBottom: 8,
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
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
