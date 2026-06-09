import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Image } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import { api, API_V1_BASE, getToken } from "../api/client";

interface DocItem {
  id: string;
  title: string;
  ocr_status: string;
  is_read: boolean;
}

const OCR_LABEL: Record<string, string> = {
  done: "完了",
  processing: "処理中",
  pending: "待機中",
  failed: "失敗",
};

type ReadFilter = "all" | "unread" | "read";
type ViewMode = "list" | "grid";

// 一覧グリッド用サムネイル（認証付きで /content を取得して表示）
function Thumb({ id }: { id: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    FileSystem.downloadAsync(`${API_V1_BASE}/documents/${id}/content`, `${FileSystem.cacheDirectory}thumb_${id}.jpg`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    })
      .then((r) => { if (alive && r.status === 200) setUri(r.uri); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);
  return uri ? <Image source={{ uri }} style={styles.gridImg} resizeMode="cover" /> : <View style={[styles.gridImg, styles.gridPlaceholder]} />;
}

// ドキュメント一覧・閲覧 (F-21, F-22, F-32)
export function DocumentListScreen() {
  const navigation = useNavigation<any>();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ReadFilter>("all");
  const [view, setView] = useState<ViewMode>("list");

  const load = useCallback(() => {
    setRefreshing(true);
    api
      .get<DocItem[]>("/documents")
      .then((r) => setDocs(r.data))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = docs.filter((d) =>
    filter === "all" ? true : filter === "unread" ? !d.is_read : d.is_read
  );
  const unreadCount = docs.filter((d) => !d.is_read).length;

  const open = (item: DocItem) =>
    navigation.navigate("Detail", { id: item.id, title: item.title });

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: "#f1f5f9" }}>
      {/* 未読/既読 切替タブ */}
      <View style={styles.tabs}>
        {([["all", "すべて"], ["unread", `未読${unreadCount ? ` (${unreadCount})` : ""}`], ["read", "既読"]] as const).map(
          ([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.tab, filter === key && styles.tabActive]}
              onPress={() => setFilter(key)}
            >
              <Text style={[styles.tabText, filter === key && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          )
        )}
        {/* 一覧/サムネイル 切替 */}
        <View style={{ flex: 1 }} />
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
              <Text style={[styles.title, !item.is_read && styles.titleUnread]}>{item.title}</Text>
              <View style={item.is_read ? styles.readBadge : styles.unreadBadge}>
                <Text style={item.is_read ? styles.readBadgeText : styles.unreadBadgeText}>
                  {item.is_read ? "既読" : "未読"}
                </Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{OCR_LABEL[item.ocr_status] ?? item.ocr_status}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>該当するドキュメントがありません。</Text>}
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
              <Thumb id={item.id} />
              {!item.is_read && <View style={styles.gridUnread} />}
              <Text numberOfLines={1} style={styles.gridTitle}>{item.title}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>該当するドキュメントがありません。</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
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
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  title: { fontSize: 15, color: "#0f172a", flex: 1, marginRight: 8 },
  titleUnread: { fontWeight: "700" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b", marginRight: 8 },
  badge: { backgroundColor: "#eef2ff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 6 },
  badgeText: { color: "#4f46e5", fontSize: 12, fontWeight: "600" },
  unreadBadge: { backgroundColor: "#fef3c7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  unreadBadgeText: { color: "#b45309", fontSize: 12, fontWeight: "700" },
  readBadge: { backgroundColor: "#f1f5f9", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  readBadgeText: { color: "#64748b", fontSize: 12, fontWeight: "600" },
  chevron: { color: "#94a3b8", fontSize: 20, marginLeft: 6 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  gridCell: { flex: 1, backgroundColor: "#fff", borderRadius: 12, marginBottom: 10, overflow: "hidden" },
  gridImg: { width: "100%", height: 150, backgroundColor: "#e2e8f0" },
  gridPlaceholder: { alignItems: "center", justifyContent: "center" },
  gridTitle: { fontSize: 13, color: "#0f172a", padding: 8 },
  gridUnread: { position: "absolute", top: 8, right: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: "#f59e0b", borderWidth: 2, borderColor: "#fff" },
});
