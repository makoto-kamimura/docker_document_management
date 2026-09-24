import axios from "axios";
import * as FileSystem from "expo-file-system/legacy";

// 端末からはホストのIP/ドメインを指定する（エミュレータでは適宜変更）
// ローカル開発時は EXPO_PUBLIC_API_BASE_URL で上書き可（例: http://192.168.x.x:8000）
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://document.makoto-kamimura.com";

const API_V1_BASE = `${BASE_URL}/api/v1`;

export const api = axios.create({
  baseURL: API_V1_BASE,
});

let token: string | null = null;
let me: User | null = null;
export function setToken(t: string) {
  token = t;
  me = null;
}
export function clearToken() {
  token = null;
  me = null;
}
export function isAuthenticated() {
  return !!token;
}
export function getToken() {
  return token;
}

api.interceptors.request.use((config) => {
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 はトークン失効とみなしログインへ戻す（Web と同じ挙動）。遷移は App 側で登録する。
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && token) {
      clearToken();
      onUnauthorized?.();
    }
    return Promise.reject(err);
  }
);

// API エラー(FastAPI の detail)を表示用メッセージにする
export function apiErrorMessage(e: any, fallback: string): string {
  return e?.response?.data?.detail ?? fallback;
}

// 認証付きでファイル(画像/PDF)を端末キャッシュへダウンロードする。
// 呼び出し側で status を見て 200 以外を扱う。
export function downloadAuthed(path: string, fileName: string) {
  return FileSystem.downloadAsync(`${API_V1_BASE}${path}`, `${FileSystem.cacheDirectory}${fileName}`, {
    headers: { Authorization: `Bearer ${token ?? ""}` },
  });
}

// ID/パスワード認証 (F-33)。取得したトークンはメモリ保持し以降の API に付与する。
export async function login(email: string, password: string) {
  const body = new URLSearchParams();
  body.append("username", email);
  body.append("password", password);
  const { data } = await api.post<{ access_token: string }>("/auth/login", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  setToken(data.access_token);
  return data;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "registrar" | "viewer";
  tenant_id: string | null;
  tenant_name: string | null;
}

/** 公開しているデモアカウント（デモテナント）。ロールごとの見え方を試せるよう3種用意する。
 *  全体管理者(super_admin)は非公開のため載せない。Web の api/client.ts と同じ内容。 */
export const DEMO_ACCOUNTS = [
  { email: "demo@example.com", password: "demo123", label: "管理者" },
  { email: "demo-registrar@example.com", password: "demo123", label: "登録者" },
  { email: "demo-viewer@example.com", password: "demo123", label: "閲覧者" },
];

// ログイン中のユーザー（家族の一覧で「自分」を見分けるのに使う）。ログイン中はキャッシュする
export async function getMe(): Promise<User> {
  if (me) return me;
  const { data } = await api.get<User>("/auth/me");
  me = data;
  return data;
}

// ---- ドキュメント (Web の api/client.ts と同じ型) ----

export interface DocumentRead {
  id: string;
  title: string;
  category: string | null;
  document_type: string | null;
  page_count: number;
  ocr_status: string;
  sensitivity: string;
  storage_location: string;
  owner_id: string;
  version: number;
  created_at: string;
  is_read: boolean;
  tags: string[];
  // 文書解析（重要度・期限など）と家族の確認状況
  importance: Importance | null;
  deadline: string | null;
  event_date: string | null;
  audience: string | null;
  keywords: string[];
  my_action: ActionStatus | null;
  family_total: number;
  family_confirmed: number;
}

export async function listDocuments(): Promise<DocumentRead[]> {
  const { data } = await api.get<DocumentRead[]>("/documents");
  return data;
}

// 閲覧ログ記録・既読化を伴う (F-28, F-32)。詳細画面を開いたときに呼ぶ。
export async function getDocument(id: string): Promise<DocumentRead> {
  const { data } = await api.get<DocumentRead>(`/documents/${id}`);
  return data;
}

// ---- 家族での確認・対応・コメント・通知 (Web の api/client.ts と同じ) ----

export type Importance = "high" | "normal" | "low";
export type ActionStatus = "seen" | "will_do" | "done" | "later";

export const ACTION_LABEL: Record<ActionStatus, string> = {
  seen: "確認した",
  will_do: "対応する",
  done: "対応済み",
  later: "あとで確認",
};
export const ACTIONS: ActionStatus[] = ["seen", "will_do", "done", "later"];

export interface Insight {
  importance: Importance;
  deadline: string | null;
  event_date: string | null;
  audience: string | null;
  keywords: string[];
  reasons: string[];
  manual: boolean;
}

export interface FamilyMember {
  user_id: string;
  name: string;
  is_owner: boolean;
  read_at: string | null;
  action: ActionStatus | null;
  action_at: string | null;
  confirmed: boolean;
}

export interface FamilyStatus {
  insight: Insight | null;
  members: FamilyMember[];
  all_confirmed: boolean;
}

export interface Comment {
  id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
}

export type NotificationKind = "new_document" | "reminder" | "renotify" | "deadline" | "comment";

export interface AppNotification {
  id: string;
  document_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

// "2026-09-30" → 期限までの日数（今日=0、過ぎたら負）
export function daysUntil(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
}

export function formatMonthDay(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}`;
}

export async function getFamilyStatus(id: string): Promise<FamilyStatus> {
  const { data } = await api.get<FamilyStatus>(`/documents/${id}/family`);
  return data;
}

export async function setMyAction(id: string, status: ActionStatus): Promise<FamilyStatus> {
  const { data } = await api.put<FamilyStatus>(`/documents/${id}/action`, { status });
  return data;
}

// 家族にもう一度知らせる。userId 未指定なら未確認の全員へ。送った人数を返す
export async function notifyFamily(id: string, userId?: string): Promise<number> {
  const { data } = await api.post<{ sent: number }>(`/documents/${id}/notify`, { user_id: userId ?? null });
  return data.sent;
}

export async function listComments(id: string): Promise<Comment[]> {
  const { data } = await api.get<Comment[]>(`/documents/${id}/comments`);
  return data;
}

export async function addComment(id: string, body: string): Promise<Comment> {
  const { data } = await api.post<Comment>(`/documents/${id}/comments`, { body });
  return data;
}

export async function listNotifications(): Promise<AppNotification[]> {
  const { data } = await api.get<AppNotification[]>("/notifications");
  return data;
}

export async function unreadNotificationCount(): Promise<number> {
  const { data } = await api.get<{ unread: number }>("/notifications/unread-count");
  return data.unread;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post("/notifications/read-all");
}

export async function registerPushToken(token: string, platform: string): Promise<void> {
  await api.post("/push-tokens", { token, platform });
}

// PDF出力の種類（Web と同じ3種）: 検索可能な電子資料PDF(F-14) / OCR全文PDF / 要約PDF
export const PDF_EXPORTS = {
  document: { path: "document-pdf", prefix: "document" },
  ocr: { path: "ocr-pdf", prefix: "ocr_text" },
  summary: { path: "pdf", prefix: "summary" },
} as const;
export type PdfKind = keyof typeof PDF_EXPORTS;

export function downloadPdf(id: string, kind: PdfKind) {
  const { path, prefix } = PDF_EXPORTS[kind];
  return downloadAuthed(`/documents/${id}/${path}`, `${prefix}_${id}.pdf`);
}

// ---- 撮影・取込 ----

export type CaptureMode = "color" | "gray" | "bw";

export interface UploadPage {
  uri: string;
  name?: string;
  type?: string;
}

// 撮影画像/取込ファイルのアップロード (F-01/F-02/F-10/F-12)。
// 複数ページ=1ドキュメント。mode はサーバー側画像処理に渡す。
export async function uploadDocument(
  title: string,
  pages: UploadPage[],
  mode: CaptureMode = "color",
  sensitivity = "internal"
) {
  const form = new FormData();
  form.append("title", title);
  form.append("sensitivity", sensitivity);
  form.append("mode", mode);
  pages.forEach((p, i) => {
    form.append("files", {
      uri: p.uri,
      name: p.name ?? `page_${i}.jpg`,
      type: p.type ?? "image/jpeg",
    } as unknown as Blob);
  });

  const { data } = await api.post("/documents", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// ---- 検索 ----

export interface SearchHit {
  id: string;
  title: string;
  snippet: string | null;
  score: number;
  category: string | null;
  tags: string[];
  matched_in: string | null;
}

// 全文検索 (F-23〜F-26)。タイトル・OCR本文・要約・タグを横断する。
export async function searchDocuments(q: string): Promise<SearchHit[]> {
  const { data } = await api.get<SearchHit[]>("/search", { params: { q } });
  return data;
}
