import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiErrorMessage, clearToken, updateMe, type User } from "../api/client";
import { useMe } from "../me";
import { colors, radius } from "../theme";

const ROLE_LABEL: Record<User["role"], string> = {
  super_admin: "全体管理者",
  admin: "管理者",
  registrar: "登録者",
  viewer: "閲覧者",
};

// アカウント: 表示名の変更（家族の確認状況・コメントに出る名前）とログアウト
export function AccountScreen({ navigation }: any) {
  const { me, setMe, refresh } = useMe();
  const [name, setName] = useState(me?.name ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me) refresh();
  }, [me, refresh]);
  useEffect(() => {
    if (me) setName(me.name);
  }, [me?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = name.trim();
  const changed = !!me && trimmed !== me.name;

  async function save() {
    if (!trimmed) {
      Alert.alert("名前を入力してください");
      return;
    }
    setSaving(true);
    try {
      setMe(await updateMe({ name: trimmed }));
      Alert.alert("変更しました", "家族の確認状況やコメントに新しい名前が表示されます。");
    } catch (e) {
      Alert.alert("エラー", apiErrorMessage(e, "名前を変更できませんでした。"));
    } finally {
      setSaving(false);
    }
  }

  function logout() {
    Alert.alert("ログアウトしますか？", undefined, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "ログアウト",
        style: "destructive",
        onPress: () => {
          clearToken();
          setMe(null);
          navigation.reset({ index: 0, routes: [{ name: "Login" }] });
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(trimmed || me?.name || "?")[0]}</Text>
        </View>
        <Text style={styles.heroName} numberOfLines={1}>{trimmed || me?.name || ""}</Text>
      </View>

      <Text style={styles.label}>表示名</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="例: はなこ"
          placeholderTextColor={colors.textSubtle}
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={() => changed && save()}
        />
      </View>
      <Text style={styles.help}>家族の確認状況やコメントに表示される名前です。</Text>
      <TouchableOpacity
        style={[styles.save, (!changed || saving) && { opacity: 0.5 }]}
        onPress={save}
        disabled={!changed || saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>保存</Text>}
      </TouchableOpacity>

      <Text style={styles.label}>アカウント情報</Text>
      <View style={styles.card}>
        <Row icon="mail-outline" label="メール" value={me?.email ?? "—"} />
        <Row icon="home-outline" label="家（テナント）" value={me?.tenant_name ?? "—"} border />
        <Row
          icon="person-outline"
          label="役割"
          value={me ? `${ROLE_LABEL[me.role]}${me.is_child ? "・子供" : ""}` : "—"}
          border
        />
      </View>

      <TouchableOpacity style={styles.logout} onPress={logout}>
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>ログアウト</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ icon, label, value, border }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; border?: boolean }) {
  return (
    <View style={[styles.row, border && styles.rowBorder]}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hero: { alignItems: "center", gap: 10, marginVertical: 12 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontWeight: "800", fontSize: 30 },
  heroName: { fontSize: 20, fontWeight: "700", color: colors.text, maxWidth: "90%" },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: 18, marginBottom: 8 },
  inputRow: { flexDirection: "row" },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  help: { fontSize: 12, color: colors.textSubtle, marginTop: 6 },
  save: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLabel: { color: colors.text, fontSize: 15 },
  rowValue: { flex: 1, textAlign: "right", color: colors.textMuted, fontSize: 14 },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 28,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  logoutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
});
