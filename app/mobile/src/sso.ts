// SSO（共通の認証サーバー）。仕様は docker_auth_server の docs/runbooks/app-integration.md。
// アプリ内のブラウザで API の開始 URL を開き、認証サーバーでログインしたあと、ディープリンクで戻ってくる
// （Expo Go では exp://…/--/auth/sso、ビルド版では dms://auth/sso）。
// 戻り URL の結果コードは、ここで作った code_verifier（PKCE）がないと交換できない。
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, getToken, setToken } from "./api/client";

export type SsoMode = "login" | "link";

export interface SsoIdentities {
  sso_enabled: boolean;
  sso_name: string | null;
  can_link: boolean;
  identities: { provider: string; email: string | null; created_at: string; last_login_at: string | null }[];
  sso_only: boolean;
  login_method: "pwd" | "sso";
}

const apiBase = () => String(api.defaults.baseURL ?? "");

/** SSO が使えるか。使えないとき・取れないときは null（ボタンを出さない） */
export async function fetchSsoName(): Promise<string | null> {
  try {
    const { data } = await api.get<{ sso?: boolean; sso_name?: string | null }>("/auth/providers");
    return data.sso ? data.sso_name || "SSO" : null;
  } catch {
    return null;
  }
}

export async function fetchSsoIdentities(): Promise<SsoIdentities> {
  return (await api.get<SsoIdentities>("/me/identities")).data;
}

export async function unlinkSso(): Promise<void> {
  await api.delete("/me/identities/sso");
}

export async function setSsoOnly(enabled: boolean): Promise<void> {
  await api.put("/me/sso-only", { enabled });
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 1 >= bytes.length ? 2 : i + 2 >= bytes.length ? 3 : 4;
    for (let j = 0; j < chars; j++) out += B64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

async function challengeOf(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 認証サーバーの画面を開く。ログインならトークンを保存する。利用者が閉じたときは false */
export async function signInWithSso(mode: SsoMode, name: string): Promise<boolean> {
  const verifier = base64url(Crypto.getRandomBytes(32));
  const redirectUri = Linking.createURL("auth/sso");
  const params = new URLSearchParams({
    mode,
    client: "mobile",
    code_challenge: await challengeOf(verifier),
    redirect_uri: redirectUri,
  });
  // 連携はログイン中の本人だけ。ブラウザには Bearer を渡せないので、先に intent を取る
  if (mode === "link") {
    params.set("intent", (await api.post<{ intent: string }>("/me/identities/sso/intent")).data.intent);
  }

  const result = await WebBrowser.openAuthSessionAsync(`${apiBase()}/auth/sso/start?${params}`, redirectUri);
  if (result.type !== "success") return false;
  const { queryParams } = Linking.parse(result.url);
  const fail = (reason: string) => new Error(ssoErrorMessage(reason, mode, name) ?? reason);
  if (queryParams?.error) throw fail(String(queryParams.error));
  const code = queryParams?.code;
  if (!code) throw fail("failed");

  const token = mode === "link" ? getToken() : null;
  const res = await fetch(`${apiBase()}/auth/sso/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ code: String(code), code_verifier: verifier }),
  });
  if (!res.ok) throw fail(res.status === 409 ? "conflict" : res.status === 400 ? "demo" : "failed");
  if (mode === "login") {
    const data = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!data.access_token) throw fail("failed");
    setToken(data.access_token);
  }
  return true;
}

export const SSO_COPY = {
  or: "または",
  login: (name: string) => `${name} でログイン`,
  loginHint: (name: string) => `「アカウント」で ${name} を連携した人だけが使えます。`,
  linkTitle: (name: string) => `${name} でログイン`,
  linkDescription: (name: string) =>
    `共通のアカウントと連携すると、ほかのアプリと同じログインで入れます。このアプリには、${name} にパスキーでログインした場合だけ入れます。`,
  linked: "連携しました。",
  linkedAs: (email: string) => `連携済み: ${email}`,
  link: (name: string) => `${name} のアカウントと連携する`,
  unlink: "連携を解除",
  unlinkConfirm: (name: string) => `連携を解除しますか？「${name} だけ」も外れ、パスワードでログインできるようになります。`,
  demoDenied: (name: string) => `デモ用のアカウントには ${name} を連携できません。`,
  ssoOnlyTitle: (name: string, on: boolean) => `${name} だけでログインする: ${on ? "オン" : "オフ"}`,
  ssoOnlyDescription:
    "オンにすると、メールアドレスとパスワードではログインできなくなります。ほかの端末でパスワードで入っているログインも、その時点で切れます。",
  ssoOnlyOn: "オンにする",
  ssoOnlyOff: "オフにする",
  ssoOnlyConfirm: (name: string) => `${name} だけでログインしますか？ メールアドレスとパスワードではログインできなくなります。`,
  ssoOnlyNeedsSso: (name: string) =>
    `オンにするには、いったんログアウトして「${name} でログイン」で入り直してください（${name} で入れることを確かめるため）。`,
} as const;

/** API から戻ってきた error を、画面に出す文に変える */
export function ssoErrorMessage(reason: string | null | undefined, mode: SsoMode, name = "SSO"): string | null {
  if (!reason) return null;
  switch (reason) {
    case "not_linked":
      return `この ${name} のアカウントは連携されていません。メールアドレスとパスワードでログインし、「アカウント」で連携してください。`;
    case "mfa_required":
      return `このアプリは 2 段階認証が必須です。${name} にパスキーでログインしてから、もう一度お試しください。`;
    case "cancelled":
      return mode === "login" ? `${name} でのログインを中止しました。` : `${name} との連携を中止しました。`;
    case "expired":
      return "有効期限が切れました。もう一度やり直してください。";
    case "conflict":
      return `この ${name} のアカウントは、ほかの利用者に連携されているか、すでに別のアカウントと連携済みです。`;
    case "demo":
      return `デモ用のアカウントには ${name} を連携できません。`;
    default:
      return mode === "login"
        ? `${name} でログインできませんでした。もう一度お試しください。`
        : `${name} と連携できませんでした。もう一度お試しください。`;
  }
}
