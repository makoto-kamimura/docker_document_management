import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { login, apiErrorMessage } from "../api/client";
import { registerForPush, takePendingDocument } from "../push";
import { colors, radius } from "../theme";

// ログイン (F-33)
export function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigation.replace("Main");
      registerForPush(); // EAS の projectId 設定時のみ。完了を待たない
      // ログイン前にタップしたプッシュ通知があればその書類を開く
      const pending = takePendingDocument();
      if (pending) navigation.navigate("Detail", { id: pending });
    } catch (e: any) {
      setError(apiErrorMessage(e, "ログインに失敗しました。接続先とIDをご確認ください。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.logo}>
        <Ionicons name="document-text" size={30} color={colors.primary} />
      </View>
      <Text style={styles.title}>紙ログ</Text>
      <Text style={styles.subtitle}>サインインして続行</Text>

      {error && (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="メールアドレス"
        placeholderTextColor={colors.textSubtle}
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        placeholder="パスワード"
        placeholderTextColor={colors.textSubtle}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
      />

      <TouchableOpacity style={[styles.btn, busy && { opacity: 0.7 }]} onPress={onSubmit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>サインイン</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 28, backgroundColor: colors.surface },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  title: { fontSize: 28, fontWeight: "800", textAlign: "center", color: colors.text },
  subtitle: { fontSize: 15, color: colors.textMuted, textAlign: "center", marginTop: 6, marginBottom: 32 },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: colors.text,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.dangerSoft,
    padding: 12,
    borderRadius: radius.md,
    marginBottom: 16,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 13 },
});
