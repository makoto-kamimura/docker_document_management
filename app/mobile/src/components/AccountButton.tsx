import { Text, TouchableOpacity, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMe } from "../me";
import { colors, radius } from "../theme";

// タブのヘッダー右: 自分の名前（頭文字のアバター＋名前）。押すとアカウント画面で名前を変えられる
export function AccountButton() {
  const navigation = useNavigation<any>();
  const { me } = useMe();
  const name = me?.name ?? "";
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={() => navigation.navigate("Account")}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={name ? `アカウント ${name}` : "アカウント"}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{name.trim()[0] ?? "?"}</Text>
      </View>
      {!!name && (
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 3,
    paddingRight: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 150,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  name: { color: colors.text, fontWeight: "600", fontSize: 13, flexShrink: 1 },
});
