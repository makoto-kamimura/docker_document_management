import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { apiErrorMessage } from "../api/client";
import {
  fetchSsoIdentities,
  setSsoOnly,
  signInWithSso,
  SSO_COPY,
  unlinkSso,
  type SsoIdentities,
} from "../sso";
import { colors, radius } from "../theme";

// アカウントの画面の SSO の欄: 連携・解除と「SSO だけでログインする」
export function SsoSection() {
  const [ids, setIds] = useState<SsoIdentities | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchSsoIdentities()
      .then(setIds)
      .catch(() => setIds(null));
  }, []);
  useEffect(load, [load]);

  if (!ids?.sso_enabled) return null;
  const name = ids.sso_name || "SSO";
  const sso = ids.identities.find((i) => i.provider === "sso");

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      const ok = await fn();
      if (done && ok !== false) Alert.alert(done);
      load();
    } catch (e) {
      Alert.alert("エラー", e instanceof Error && !(e as any).response ? e.message : apiErrorMessage(e, "操作できませんでした。"));
    } finally {
      setBusy(false);
    }
  }

  const confirm = (title: string, label: string, onOk: () => void) =>
    Alert.alert(title, undefined, [
      { text: "キャンセル", style: "cancel" },
      { text: label, style: "destructive", onPress: onOk },
    ]);

  return (
    <>
      <Text style={styles.label}>{SSO_COPY.linkTitle(name)}</Text>
      <View style={styles.card}>
        <Text style={styles.help}>{SSO_COPY.linkDescription(name)}</Text>
        {busy && <ActivityIndicator style={{ marginTop: 10 }} color={colors.primary} />}
        {sso ? (
          <>
            <Text style={styles.body}>{SSO_COPY.linkedAs(sso.email ?? name)}</Text>
            <Text style={styles.body}>{SSO_COPY.ssoOnlyTitle(name, ids.sso_only)}</Text>
            <Text style={styles.help}>{SSO_COPY.ssoOnlyDescription}</Text>
            {ids.sso_only ? (
              <Button title={SSO_COPY.ssoOnlyOff} disabled={busy} onPress={() => run(() => setSsoOnly(false))} />
            ) : ids.login_method === "sso" ? (
              <Button
                title={SSO_COPY.ssoOnlyOn}
                disabled={busy}
                onPress={() => confirm(SSO_COPY.ssoOnlyConfirm(name), SSO_COPY.ssoOnlyOn, () => run(() => setSsoOnly(true)))}
              />
            ) : (
              <Text style={styles.help}>{SSO_COPY.ssoOnlyNeedsSso(name)}</Text>
            )}
            <Button
              title={SSO_COPY.unlink}
              disabled={busy}
              onPress={() => confirm(SSO_COPY.unlinkConfirm(name), SSO_COPY.unlink, () => run(unlinkSso))}
            />
          </>
        ) : ids.can_link ? (
          <Button title={SSO_COPY.link(name)} disabled={busy} onPress={() => run(() => signInWithSso("link", name), SSO_COPY.linked)} />
        ) : (
          <Text style={styles.body}>{SSO_COPY.demoDenied(name)}</Text>
        )}
      </View>
    </>
  );
}

function Button({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[styles.btn, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}>
      <Text style={styles.btnText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14 },
  help: { fontSize: 12, color: colors.textSubtle, marginTop: 6 },
  body: { fontSize: 14, color: colors.text, marginTop: 10 },
  btn: {
    marginTop: 12,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  btnText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
});
