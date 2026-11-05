import axios from "axios";
import { File, Paths } from "expo-file-system";

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

// JWT を付与。テナントはサーバーが決める（全体管理者は Web のテナント管理で選んだテナント）
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

// 時間をおけば通る可能性があるエラーか（応答なし=オフライン等 / 5xx）。4xx は再送しても通らない
export function isTransientError(e: any): boolean {
  return !e?.response || e.response.status >= 500;
}

// 認証付きでファイル(画像/PDF)を端末キャッシュへダウンロードする。
// 呼び出し側で status を見て 200 以外を扱う（File.downloadFileAsync は 2xx 以外を例外にして
// ステータスを返さないため、fetch で取得して書き込む）。
export async function downloadAuthed(path: string, fileName: string): Promise<{ status: number; uri: string }> {
  const res = await fetch(`${API_V1_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ""}` },
  });
  const file = new File(Paths.cache, fileName);
  if (res.ok) {
    file.create({ overwrite: true });
    await file.write(new Uint8Array(await res.arrayBuffer())); // SDK 58 から非同期
  }
  return { status: res.status, uri: file.uri };
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
  tenant_id: string | null;   // 全体管理者は操作中のテナント（未選択なら null）
  tenant_name: string | null;
  is_child: boolean;
}

// ログイン中のユーザー（家族の一覧で「自分」を見分けるのに使う）。ログイン中はキャッシュする。
// refresh で取り直す（全体管理者が Web で操作するテナントを切り替えたときなど）
export async function getMe(refresh = false): Promise<User> {
  if (me && !refresh) return me;
  const { data } = await api.get<User>("/auth/me");
  me = data;
  return data;
}

// 自分の表示名を変える（家族の確認状況・コメントに出る名前）。キャッシュも差し替える
export async function updateMe(patch: { name: string }): Promise<User> {
  const { data } = await api.patch<User>("/auth/me", patch);
  me = data;
  return data;
}

// ---- カテゴリ（公開範囲つき。Web の api/client.ts と同じ） ----

// 見られる人の範囲。管理者にも適用される（「本人だけ」は登録した本人以外は誰も見られない）
export type CategoryVisibility = "everyone" | "adults" | "family" | "owner";
export const VISIBILITY_LABEL: Record<CategoryVisibility, string> = {
  everyone: "全員",
  adults: "子供以外",
  family: "家族",
  owner: "本人だけ",
};
// 撮影の確認画面で、選んだカテゴリの範囲を一行で伝える
export const VISIBILITY_HELP: Record<CategoryVisibility, string> = {
  everyone: "家族全員が見られます",
  adults: "子供は見られません",
  family: "同じグループの家族と、共有した人が見られます",
  owner: "自分だけが見られます",
};

export interface Category {
  id: string;
  name: string;
  visibility: CategoryVisibility;
  icon: string | null;   // Ionicons の名前（-outline を除いた形）。categoryStyle.tsx
  color: string | null;  // categoryStyle.tsx の CATEGORY_COLORS の名前
  document_count: number;
}

// カテゴリの追加・変更は Web のカテゴリ管理（管理者）で行う
export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>("/categories");
  return data;
}

// ---- ドキュメント (Web の api/client.ts と同じ型) ----

export interface DocumentRead {
  id: string;
  title: string;
  category_id: string | null;
  category: string | null;              // カテゴリ名（未分類は null）
  category_visibility: CategoryVisibility; // 見られる人の範囲（未分類は family）
  category_icon: string | null;          // カテゴリのアイコン・色（categoryStyle.tsx）
  category_color: string | null;
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

// 日時（ISO）→ "10/25 14:30"（端末の時刻）
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const OCR_LABEL: Record<string, string> = {
  done: "完了",
  processing: "読み取り中",
  pending: "待機中",
  failed: "失敗",
};

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

// PDF出力の種類（Web と同じ2種）: 検索可能な電子資料PDF(F-14) / OCR全文PDF
export const PDF_EXPORTS = {
  document: { path: "document-pdf", prefix: "document" },
  ocr: { path: "ocr-pdf", prefix: "ocr_text" },
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
// 複数ページ=1ドキュメント。mode はサーバー側画像処理に渡す。categoryId でカテゴリに入れる（未指定は未分類）
export async function uploadDocument(
  title: string,
  pages: UploadPage[],
  mode: CaptureMode = "color",
  categoryId: string | null = null,
  sensitivity = "internal"
) {
  const form = new FormData();
  form.append("title", title);
  form.append("sensitivity", sensitivity);
  form.append("mode", mode);
  if (categoryId) form.append("category_id", categoryId);
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

// 全文検索 (F-23〜F-26)。タイトル・OCR本文・タグを横断する（ひらがなの読み・OCRの読み違いでも当たる）。
export async function searchDocuments(q: string): Promise<SearchHit[]> {
  const { data } = await api.get<SearchHit[]>("/search", { params: { q } });
  return data;
}
