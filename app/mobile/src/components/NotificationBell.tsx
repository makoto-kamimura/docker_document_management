import { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { unreadNotificationCount } from "../api/client";

const POLL_MS = 30000;

// ヘッダーの 🔔（未読のお知らせ件数バッジ付き）。画面に戻ったときと30秒ごとに更新する
export function NotificationBell() {
  const navigation = useNavigation<any>();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    unreadNotificationCount().then(setCount).catch(() => {});
  }, []);

  useFocusEffect(refresh);
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <TouchableOpacity onPress={() => navigation.navigate("Notifications")} accessibilityLabel="お知らせ">
      <View>
        <Text style={{ fontSize: 20 }}>🔔</Text>
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: -4, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
