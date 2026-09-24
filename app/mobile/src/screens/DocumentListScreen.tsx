import { useCallback, useState } from "react";
import { View, Text, FlatList, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { listDocuments, type DocumentRead } from "../api/client";
import { DocThumb } from "../components/DocThumb";
import { DeadlineChip, ImportanceBadge } from "../components/FamilyBadges";

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
  { key: "important", label: "🔴 重要", match: (d) => d.importance === "high" },
  { key: "deadline", label: "📅 期限あり", match: (d) => !!d.deadline },
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

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: "#f1f5f9" }}>
      <View style={styles.tabsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {FILTERS.map((f) => {
            const n = countOf(f);
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.tab, filter === f.key && styles.tabActive]}
                onPress={() => setFilter(f.key)}
              >
                <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>
                  {f.label}{n ? ` (${n})` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* 一覧/サムネイル 切替 */}
        <TouchableOpacity style={[styles.viewBtn, view === "list" && styles.viewBtnActive]} onPress={() => setView("list")}>
          <Text style={[styles.viewText, view === "list" && styles.viewTextActive]}>≣</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.viewBtn, view === "grid" && styles.viewBtnActive]} onPress={() => setView("grid")}>
          <Text style={[styles.viewText, view === "grid" && styles.viewTextActive]}>▦</Text>
        </TouchableOpacity>
      </View>

      {view === "list" ? (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => open(item)}>
              {!item.is_read && <View style={styles.unreadDot} />}
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
              <View style={item.is_read ? styles.readBadge : styles.unreadBadge}>
                <Text style={item.is_read ? styles.readBadgeText : styles.unreadBadgeText}>
                  {item.is_read ? "既読" : "未読"}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>該当する紙がありません。</Text>}
        />
      ) : (
        <FlatList
          data={shown}
          key="grid"
          numColumns={2}
          keyExtractor={(d) => d.id}
          columnWrapperStyle={{ gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.gridCell} onPress={() => open(item)}>
              <DocThumb id={item.id} style={styles.gridImg} />
              {!item.is_read && <View style={styles.gridUnread} />}
              {item.importance === "high" && <Text style={styles.gridImportant}>🔴 重要</Text>}
              <Text numberOfLines={1} style={styles.gridTitle}>{item.title}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>該当する紙がありません。</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabsRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  tabs: { gap: 6, paddingRight: 8 },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#e2e8f0" },
  tabActive: { backgroundColor: "#4f46e5" },
  tabText: { color: "#475569", fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: "#fff" },
  viewBtn: { width: 34, height: 30, borderRadius: 8, backgroundColor: "#e2e8f0", alignItems: "center", justifyContent: "center", marginLeft: 4 },
  viewBtnActive: { backgroundColor: "#4f46e5" },
  viewText: { color: "#475569", fontSize: 16 },
  viewTextActive: { color: "#fff" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  title: { fontSize: 15, color: "#0f172a", marginRight: 8 },
  titleUnread: { fontWeight: "700" },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  metaText: { fontSize: 12, color: "#64748b" },
  metaPending: { color: "#b45309", fontWeight: "700" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b", marginRight: 8 },
  unreadBadge: { backgroundColor: "#fef3c7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  unreadBadgeText: { color: "#b45309", fontSize: 12, fontWeight: "700" },
  readBadge: { backgroundColor: "#f1f5f9", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  readBadgeText: { color: "#64748b", fontSize: 12, fontWeight: "600" },
  chevron: { color: "#94a3b8", fontSize: 20, marginLeft: 6 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  gridCell: { flex: 1, backgroundColor: "#fff", borderRadius: 12, marginBottom: 10, overflow: "hidden" },
  gridImg: { width: "100%", height: 150, backgroundColor: "#e2e8f0" },
  gridTitle: { fontSize: 13, color: "#0f172a", padding: 8 },
  gridUnread: { position: "absolute", top: 8, right: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: "#f59e0b", borderWidth: 2, borderColor: "#fff" },
  gridImportant: { position: "absolute", top: 8, left: 8, fontSize: 11, fontWeight: "700", color: "#b91c1c", backgroundColor: "#fee2e2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, overflow: "hidden" },
});
