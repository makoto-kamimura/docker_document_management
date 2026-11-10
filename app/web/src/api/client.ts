import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const TOKEN_KEY = "access_token";
// 以前の版が保存していた全体管理者の操作対象テナント。今はサーバー側（テナント管理で切り替え）で持つ
const LEGACY_TENANT_KEY = "active_tenant";

export const ISSUE_URL = "https://github.com/makoto-kamimura/docker_document_management/issues/new";

export const api = axios.create({
  baseURL: `${baseURL}/api/v1`,
});

// JWT を付与。全体管理者の操作対象テナントはサーバー側で持つ（Web のテナント管理で切り替える）
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 はトークン失効とみなしログインへ戻す
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && getToken()) {
      clearToken();
      if (location.pathname !== "/login") location.assign("/login");
    }
    return Promise.reject(err);
  }
);

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TENANT_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// API エラー(FastAPI の detail)を表示用メッセージにする
export function apiErrorMessage(e: any, fallback: string): string {
  return e?.response?.data?.detail ?? fallback;
}

export interface DocumentRead {
  id: string;
  tenant_id: string | null;
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
  can_delete: boolean; // 自分がこの書類を削除できるか
}

// 単体取得のみ OCR全文を含む
export interface DocumentDetail extends DocumentRead {
  ocr_text: string | null;
}

export interface DocumentUpdate {
  title?: string;
  category_id?: string | null;  // null で未分類に戻す
  document_type?: string | null;
  sensitivity?: string;
  tags?: string[];
  ocr_text?: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  page_count: number;
  file_format: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string | null;
  score: number;
  category: string | null;
  tags: string[];
  matched_in: string | null;
}

export async function login(email: string, password: string): Promise<void> {
  // OAuth2PasswordRequestForm は form-urlencoded を要求する
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);
  const { data } = await api.post<{ access_token: string }>("/auth/login", body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  setToken(data.access_token);
}

export async function listDocuments(): Promise<DocumentRead[]> {
  const { data } = await api.get<DocumentRead[]>("/documents");
  return data;
}

export async function searchDocuments(
  q: string,
  opts?: { categoryId?: string; tag?: string }
): Promise<SearchHit[]> {
  const { data } = await api.get<SearchHit[]>("/search", {
    params: { q, category_id: opts?.categoryId, tag: opts?.tag },
  });
  return data;
}

// ---- カテゴリ（公開範囲つき）。一覧は誰でも、追加・変更・削除は管理者のみ ----

// 見られる人の範囲。管理者・全体管理者にも適用される（「本人だけ」は登録した本人以外は誰も見られない）
export type CategoryVisibility = "everyone" | "adults" | "family" | "owner";
export const VISIBILITY_LABEL: Record<CategoryVisibility, string> = {
  everyone: "全員",
  adults: "子供以外",
  family: "家族",
  owner: "本人だけ",
};
export const VISIBILITY_HELP: Record<CategoryVisibility, string> = {
  everyone: "テナントの全員が見られます",
  adults: "子供の印が付いた人は見られません",
  family: "登録した人と同じグループの家族・個別に共有した人・管理者が見られます",
  owner: "登録した本人だけが見られます（管理者も見られません）",
};
// 広い順（範囲を広げる変更の確認に使う）
export const VISIBILITY_ORDER: CategoryVisibility[] = ["owner", "family", "adults", "everyone"];

export interface Category {
  id: string;
  name: string;
  visibility: CategoryVisibility;
  sort_order: number;
  icon: string | null;   // Ionicons の名前（-outline を除いた形）。categoryStyle.tsx の一覧から選ぶ
  color: string | null;  // categoryStyle.tsx の CATEGORY_COLORS の名前
  created_at: string;
  document_count: number; // 自分が見られる書類の件数
}

export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>("/categories");
  return data;
}

export async function createCategory(payload: {
  name: string;
  visibility: CategoryVisibility;
  icon?: string;
  color?: string;
}): Promise<Category> {
  const { data } = await api.post<Category>("/categories", payload);
  return data;
}

export async function updateCategory(
  id: string,
  patch: { name?: string; visibility?: CategoryVisibility; sort_order?: number; icon?: string; color?: string }
): Promise<Category> {
  const { data } = await api.patch<Category>(`/categories/${id}`, patch);
  return data;
}

export async function deleteCategory(id: string): Promise<void> {
  await api.delete(`/categories/${id}`);
}

// ---- メタデータ/OCR編集・バージョン・印刷ログ (F-16/F-17/F-19/F-27) ----

export async function updateDocument(
  id: string,
  patch: DocumentUpdate
): Promise<DocumentRead> {
  const { data } = await api.patch<DocumentRead>(`/documents/${id}`, patch);
  return data;
}

// 書類を完全に削除する（元に戻せない）。所有者・管理者・削除可を付与された人だけ
export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`);
}

// 閲覧ログ記録・既読化を伴う (F-28, F-32)。ビューアを開いたときに呼ぶ。
export async function getDocument(id: string): Promise<DocumentDetail> {
  const { data } = await api.get<DocumentDetail>(`/documents/${id}`);
  return data;
}

export async function listVersions(id: string): Promise<DocumentVersion[]> {
  const { data } = await api.get<DocumentVersion[]>(`/documents/${id}/versions`);
  return data;
}

export async function logPrint(id: string): Promise<void> {
  await api.post(`/documents/${id}/print-log`);
}

// PDF出力の種類（モバイルと同じ2種）: 検索可能な電子資料PDF(F-14) / OCR全文PDF
export const PDF_EXPORTS = {
  document: { path: "document-pdf", prefix: "document" },
  ocr: { path: "ocr-pdf", prefix: "ocr_text" },
} as const;
export type PdfKind = keyof typeof PDF_EXPORTS;

export async function downloadPdf(id: string, kind: PdfKind, title: string): Promise<void> {
  const { path, prefix } = PDF_EXPORTS[kind];
  const r = await api.get(`/documents/${id}/${path}`, { responseType: "blob" });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}_${title || id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- ユーザー・権限のマスタ管理 (F-35, F-38) ----

export type Role = "super_admin" | "admin" | "registrar" | "viewer";
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "全体管理者",
  admin: "管理者",
  registrar: "登録者",
  viewer: "閲覧者",
};
// テナント管理者が割り当てられるロール（全体管理者は別枠で、画面からは付与できない）
export const ASSIGNABLE_ROLES: Role[] = ["admin", "registrar", "viewer"];

// 管理画面（ユーザー/グループ管理）を開けるか
export function isAdminRole(role: Role | undefined | null): boolean {
  return role === "admin" || role === "super_admin";
}
export type PermissionLevel = "view" | "edit" | "delete";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  // 所属テナント。/auth/me の全体管理者は操作中のテナント（未選択なら null）
  tenant_id: string | null;
  tenant_name: string | null;
  is_child: boolean;          // 子供（公開範囲「子供以外」の書類を見られない）
  created_at: string;
}

// ユーザーは操作中のテナントに作る。テナント間の移動はテナント管理で行う
export interface UserCreate {
  email: string;
  name: string;
  role: Role;
  password: string;
  is_child?: boolean;
}

export interface UserUpdate {
  name?: string;
  role?: Role;
  is_child?: boolean;
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>("/auth/me");
  return data;
}

// 自分の表示名を変える（ログイン中の本人なら誰でも）
export async function updateMe(patch: { name: string }): Promise<User> {
  const { data } = await api.patch<User>("/auth/me", patch);
  return data;
}

export async function listUsers(): Promise<User[]> {
  const { data } = await api.get<User[]>("/users");
  return data;
}

export async function createUser(payload: UserCreate): Promise<User> {
  const { data } = await api.post<User>("/users", payload);
  return data;
}

export async function updateUser(id: string, patch: UserUpdate): Promise<User> {
  const { data } = await api.patch<User>(`/users/${id}`, patch);
  return data;
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await api.post(`/users/${id}/password`, { password });
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`);
}

// ---- テナント（データ分離の単位） ----

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_demo: boolean;
  created_at: string;
  user_count: number;
  document_count: number;
}

export interface TenantCreate {
  slug: string;
  name: string;
  description?: string | null;
  is_demo?: boolean;
}

// テナントの API はすべて全体管理者のみ（Web のテナント管理からだけ使う）
export async function listTenants(): Promise<Tenant[]> {
  const { data } = await api.get<Tenant[]>("/tenants");
  return data;
}

// 操作中のテナントを切り替える。以後の一覧・撮影・ユーザー管理などはこのテナントの中で動く
export async function switchTenant(id: string): Promise<Tenant> {
  const { data } = await api.put<Tenant>("/tenants/active", { tenant_id: id });
  return data;
}

export async function listTenantUsers(id: string): Promise<User[]> {
  const { data } = await api.get<User[]>(`/tenants/${id}/users`);
  return data;
}

// ユーザーを別のテナントへ移す（所有ドキュメント・通知も一緒に移る）
export async function moveUserToTenant(tenantId: string, userId: string): Promise<User> {
  const { data } = await api.put<User>(`/tenants/${tenantId}/users/${userId}`);
  return data;
}

export async function createTenant(payload: TenantCreate): Promise<Tenant> {
  const { data } = await api.post<Tenant>("/tenants", payload);
  return data;
}

export async function updateTenant(
  id: string,
  patch: { name?: string; description?: string | null; is_demo?: boolean }
): Promise<Tenant> {
  const { data } = await api.patch<Tenant>(`/tenants/${id}`, patch);
  return data;
}

export async function deleteTenant(id: string): Promise<void> {
  await api.delete(`/tenants/${id}`);
}

// ---- 保存先（外部ストレージ連携）。テナント管理者のみ ----

export type StoragePreset = "r2" | "s3" | "synology" | "gdrive";

export const STORAGE_PRESET_LABEL: Record<StoragePreset, string> = {
  r2: "Cloudflare R2",
  s3: "S3 互換",
  synology: "Synology NAS（WebDAV）",
  gdrive: "Google ドライブ",
};

export interface StorageBackend {
  id: string;
  kind: "s3" | "webdav" | "gdrive";
  preset: StoragePreset;
  name: string;
  config: Record<string, any>;
  is_onprem: boolean;
  has_secret: boolean;
  is_active: boolean;
  document_count: number;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  last_tested_at: string | null;
  created_at: string;
}

export interface StorageOverview {
  active_backend_id: string | null;
  backends: StorageBackend[];
  secret_key_configured: boolean;
  google_enabled: boolean;
  editable: boolean;
}

export interface StorageTestResult {
  ok: boolean;
  error: string | null;
  backend: StorageBackend;
}

export interface StorageBackendInput {
  name?: string;
  config?: Record<string, any>;
  secret?: Record<string, string>;
  is_onprem?: boolean;
}

export async function getStorageOverview(): Promise<StorageOverview> {
  const { data } = await api.get<StorageOverview>("/storage");
  return data;
}

export async function createStorageBackend(
  payload: StorageBackendInput & { preset: Exclude<StoragePreset, "gdrive">; name: string }
): Promise<StorageTestResult> {
  const { data } = await api.post<StorageTestResult>("/storage/backends", payload);
  return data;
}

export async function updateStorageBackend(id: string, patch: StorageBackendInput): Promise<StorageTestResult> {
  const { data } = await api.patch<StorageTestResult>(`/storage/backends/${id}`, patch);
  return data;
}

export async function deleteStorageBackend(id: string): Promise<void> {
  await api.delete(`/storage/backends/${id}`);
}

export async function testStorageBackend(id: string): Promise<StorageTestResult> {
  const { data } = await api.post<StorageTestResult>(`/storage/backends/${id}/test`);
  return data;
}

// null で既定の保存先（サーバー内の MinIO）に戻す
export async function setActiveStorage(backendId: string | null): Promise<StorageOverview> {
  const { data } = await api.put<StorageOverview>("/storage/active", { backend_id: backendId });
  return data;
}

// Google の同意画面の URL。backendId を渡すと既存の連携をつなぎ直す
export async function googleAuthorizeUrl(backendId?: string): Promise<string> {
  const { data } = await api.get<{ url: string }>("/storage/google/authorize", {
    params: backendId ? { backend_id: backendId } : undefined,
  });
  return data.url;
}

// ---- ドキュメント単位ACL (F-36, F-37) ----

export interface DocumentPermission {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  level: PermissionLevel;
}

export async function listPermissions(docId: string): Promise<DocumentPermission[]> {
  const { data } = await api.get<DocumentPermission[]>(`/documents/${docId}/permissions`);
  return data;
}

export async function upsertPermission(
  docId: string,
  userId: string,
  level: PermissionLevel
): Promise<DocumentPermission> {
  const { data } = await api.put<DocumentPermission>(
    `/documents/${docId}/permissions/${userId}`,
    { level }
  );
  return data;
}

export async function removePermission(docId: string, userId: string): Promise<void> {
  await api.delete(`/documents/${docId}/permissions/${userId}`);
}

// ---- グループ (F-36 自動共有) ----

export interface Group {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  member_count: number;
}

export interface GroupMember {
  user_id: string;
  name: string;
  email: string;
  role: Role;
}

export async function listGroups(): Promise<Group[]> {
  const { data } = await api.get<Group[]>("/groups");
  return data;
}

export async function createGroup(payload: { name: string; description?: string | null }): Promise<Group> {
  const { data } = await api.post<Group>("/groups", payload);
  return data;
}

export async function deleteGroup(id: string): Promise<void> {
  await api.delete(`/groups/${id}`);
}

export async function listGroupMembers(id: string): Promise<GroupMember[]> {
  const { data } = await api.get<GroupMember[]>(`/groups/${id}/members`);
  return data;
}

export async function addGroupMember(id: string, userId: string): Promise<void> {
  await api.put(`/groups/${id}/members/${userId}`);
}

export async function removeGroupMember(id: string, userId: string): Promise<void> {
  await api.delete(`/groups/${id}/members/${userId}`);
}

// ---- 家族での確認・対応・コメント・通知 (モバイルの api/client.ts と同じ) ----

export type Importance = "high" | "normal" | "low";
export type ActionStatus = "seen" | "will_do" | "done" | "later";

export const ACTION_LABEL: Record<ActionStatus, string> = {
  seen: "確認した",
  will_do: "対応する",
  done: "対応済み",
  later: "あとで確認",
};
export const ACTIONS: ActionStatus[] = ["seen", "will_do", "done", "later"];

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: "重要",
  normal: "通常",
  low: "低（広告など）",
};

export interface Insight {
  importance: Importance;
  deadline: string | null;
  event_date: string | null;
  audience: string | null;
  keywords: string[];
  reasons: string[];
  manual: boolean;
}

export interface InsightUpdate {
  importance?: Importance;
  deadline?: string | null;
  event_date?: string | null;
  audience?: string | null;
  keywords?: string[];
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

export async function updateInsight(id: string, patch: InsightUpdate): Promise<FamilyStatus> {
  const { data } = await api.put<FamilyStatus>(`/documents/${id}/insight`, patch);
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
