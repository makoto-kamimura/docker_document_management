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
import { login } from "../api/client";

// ログイン (F-33)
export function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigation.replace("Camera");
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(detail ?? "ログインに失敗しました。接続先とIDをご確認ください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>📄</Text>
        </View>
        <Text style={styles.title}>ドキュメント管理</Text>
        <Text style={styles.subtitle}>サインインして続行</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.label}>メールアドレス</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
        />

        <Text style={styles.label}>パスワード</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />

        <TouchableOpacity style={styles.btn} onPress={onSubmit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>サインイン</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>開発用: admin@example.com / admin123</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#0f172a",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 28,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#eef2ff",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoText: { fontSize: 28 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center", color: "#0f172a" },
  subtitle: { fontSize: 14, color: "#64748b", textAlign: "center", marginTop: 4, marginBottom: 22 },
  label: { fontSize: 13, fontWeight: "600", color: "#0f172a", marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  btn: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 22,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  error: {
    backgroundColor: "#fff1f2",
    color: "#e11d48",
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  hint: { textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 16 },
});
