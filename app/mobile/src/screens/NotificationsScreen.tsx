import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationKind,
} from "../api/client";

const KIND_ICON: Record<NotificationKind, string> = {
  new_document: "📄",
  reminder: "⏰",
  renotify: "🔔",
  deadline: "📅",
  comment: "💬",
};

function ago(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}時間前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 家族からのお知らせ一覧（新しい紙・リマインド・再通知・期限・コメント）
export function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    listNotifications()
      .then(setItems)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hasUnread = items.some((n) => !n.read_at);
  useEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        hasUnread ? (
          <TouchableOpacity
            onPress={() => markAllNotificationsRead().then(load).catch(() => {})}
          >
            <Text style={{ color: "#2563eb", fontWeight: "600" }}>すべて既読</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, hasUnread, load]);

  function open(n: AppNotification) {
    if (!n.read_at) {
      markNotificationRead(n.id).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    if (n.document_id) navigation.navigate("Detail", { id: n.document_id });
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: "#f1f5f9" }}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, !item.read_at && styles.rowUnread]} onPress={() => open(item)}>
            <Text style={styles.icon}>{KIND_ICON[item.kind] ?? "🔔"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, !item.read_at && styles.titleUnread]} numberOfLines={2}>
                {item.title}
              </Text>
              {!!item.body && <Text style={styles.body} numberOfLines={2}>{item.body}</Text>}
              <Text style={styles.at}>{ago(item.created_at)}</Text>
            </View>
            {!item.read_at && <View style={styles.dot} />}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>お知らせはありません。</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, backgroundColor: "#fff", padding: 14, borderRadius: 12, marginBottom: 10, alignItems: "flex-start" },
  rowUnread: { borderLeftWidth: 4, borderLeftColor: "#f59e0b" },
  icon: { fontSize: 20 },
  title: { fontSize: 14, color: "#0f172a" },
  titleUnread: { fontWeight: "700" },
  body: { fontSize: 13, color: "#475569", marginTop: 3 },
  at: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b", marginTop: 6 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
