import { useEffect, useState } from "react";
import {
  Image,
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
import { fetchSsoName, signInWithSso, SSO_COPY } from "../sso";
import { colors, radius } from "../theme";

// ログイン (F-33)
export function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<string | null>(null);

  useEffect(() => {
    void fetchSsoName().then(setSso);
  }, []);

  function enter() {
    navigation.replace("Main");
    registerForPush(); // EAS の projectId 設定時のみ。完了を待たない
    // ログイン前にタップしたプッシュ通知があればその書類を開く
    const pending = takePendingDocument();
    if (pending) navigation.navigate("Detail", { id: pending });
  }

  async function onSso() {
    setError(null);
    setBusy(true);
    try {
      if (await signInWithSso("login", sso ?? "SSO")) enter();
    } catch (e: any) {
      setError(e instanceof Error ? e.message : "ログインに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      enter();
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
      <Image source={require("../../assets/logo.png")} style={styles.logo} accessibilityIgnoresInvertColors />
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

      {sso && (
        <>
          <Text style={styles.or}>{SSO_COPY.or}</Text>
          <TouchableOpacity style={[styles.ssoBtn, busy && { opacity: 0.7 }]} onPress={onSso} disabled={busy}>
            <Text style={styles.ssoBtnText}>{SSO_COPY.login(sso)}</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>{SSO_COPY.loginHint(sso)}</Text>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 28, backgroundColor: colors.surface },
  logo: {
    width: 72,
    height: 72,
    alignSelf: "center",
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
  or: { textAlign: "center", color: colors.textSubtle, fontSize: 13, marginTop: 18, marginBottom: 8 },
  ssoBtn: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  ssoBtnText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
  hint: { color: colors.textSubtle, fontSize: 12, marginTop: 8, textAlign: "center" },
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
