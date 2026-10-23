import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationKind,
} from "../api/client";
import { colors, radius } from "../theme";
import { useUnread } from "../unread";

const KIND_ICON: Record<NotificationKind, keyof typeof Ionicons.glyphMap> = {
  new_document: "document-text-outline",
  reminder: "alarm-outline",
  renotify: "notifications-outline",
  deadline: "calendar-outline",
  comment: "chatbubble-outline",
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
  const { refresh: refreshUnread } = useUnread();
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
            style={{ marginRight: 16 }}
            onPress={() =>
              markAllNotificationsRead()
                .then(() => { load(); refreshUnread(); })
                .catch(() => {})
            }
          >
            <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 15 }}>すべて既読</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, hasUnread, load, refreshUnread]);

  function open(n: AppNotification) {
    if (!n.read_at) {
      markNotificationRead(n.id).then(refreshUnread).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    if (n.document_id) navigation.navigate("Detail", { id: n.document_id });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => open(item)}>
            <View style={[styles.icon, !item.read_at && styles.iconUnread]}>
              <Ionicons
                name={KIND_ICON[item.kind] ?? "notifications-outline"}
                size={18}
                color={item.read_at ? colors.textMuted : colors.primary}
              />
            </View>
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
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={40} color={colors.textSubtle} />
            <Text style={styles.emptyText}>お知らせはありません。</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.lg,
    marginBottom: 8,
    alignItems: "flex-start",
  },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  iconUnread: { backgroundColor: colors.primarySoft },
  title: { fontSize: 14, color: colors.text, lineHeight: 20 },
  titleUnread: { fontWeight: "700" },
  body: { fontSize: 13, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  at: { fontSize: 11, color: colors.textSubtle, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
  empty: { alignItems: "center", marginTop: 80, gap: 10 },
  emptyText: { color: colors.textSubtle, fontSize: 14 },
});
