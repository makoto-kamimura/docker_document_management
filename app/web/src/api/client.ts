import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const TOKEN_KEY = "access_token";
// 全体管理者(super_admin)が操作対象にしているテナント。一般ユーザーは自分のテナント固定のため未使用。
const TENANT_KEY = "active_tenant";

export const ISSUE_URL = "https://github.com/makoto-kamimura/docker_document_management/issues/new";

export const api = axios.create({
  baseURL: `${baseURL}/api/v1`,
});

// JWT と（全体管理者なら）操作対象テナントを付与
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const tenant = localStorage.getItem(TENANT_KEY);
  if (tenant) {
    config.headers["X-Tenant-Id"] = tenant;
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
  localStorage.removeItem(TENANT_KEY);
}

// ---- 操作対象テナント (super_admin のみ。null = 全テナント横断) ----

export function getActiveTenant(): string | null {
  return localStorage.getItem(TENANT_KEY);
}

export function setActiveTenant(tenantId: string | null): void {
  if (tenantId) localStorage.setItem(TENANT_KEY, tenantId);
  else localStorage.removeItem(TENANT_KEY);
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

// 単体取得のみ OCR全文を含む
export interface DocumentDetail extends DocumentRead {
  ocr_text: string | null;
}

export interface DocumentUpdate {
  title?: string;
  category?: string | null;
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
  opts?: { category?: string; tag?: string }
): Promise<SearchHit[]> {
  const { data } = await api.get<SearchHit[]>("/search", {
    params: { q, category: opts?.category, tag: opts?.tag },
  });
  return data;
}

// ---- メタデータ/OCR編集・バージョン・印刷ログ (F-16/F-17/F-19/F-27) ----

export async function updateDocument(
  id: string,
  patch: DocumentUpdate
): Promise<DocumentRead> {
  const { data } = await api.patch<DocumentRead>(`/documents/${id}`, patch);
  return data;
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

// PDF出力の種類（モバイルと同じ3種）: 検索可能な電子資料PDF(F-14) / OCR全文PDF / 要約PDF
export const PDF_EXPORTS = {
  document: { path: "document-pdf", prefix: "document" },
  ocr: { path: "ocr-pdf", prefix: "ocr_text" },
  summary: { path: "pdf", prefix: "summary" },
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

/** 公開しているデモアカウント（デモテナント）。ロールごとの見え方を試せるよう3種用意する。
 *  全体管理者(super_admin)は非公開のため、ここには載せない。
 *  バックエンドの SEED_DEMO_* を変更した場合はここも合わせる。 */
export const DEMO_ACCOUNTS = [
  {
    email: "demo@example.com",
    password: "demo123",
    role: "admin" as Role,
    label: "管理者",
    description: "ユーザー/グループ管理・テナント内の全書類",
  },
  {
    email: "demo-registrar@example.com",
    password: "demo123",
    role: "registrar" as Role,
    label: "登録者",
    description: "撮影・登録と共有された書類の閲覧",
  },
  {
    email: "demo-viewer@example.com",
    password: "demo123",
    role: "viewer" as Role,
    label: "閲覧者",
    description: "共有された書類の閲覧のみ",
  },
];

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
  tenant_id: string | null;   // 全体管理者は null
  tenant_name: string | null;
  created_at: string;
}

export interface UserCreate {
  email: string;
  name: string;
  role: Role;
  password: string;
  tenant_id?: string | null;  // 全体管理者のみ指定できる（他は自テナント固定）
}

export interface UserUpdate {
  name?: string;
  role?: Role;
  tenant_id?: string;         // テナント移動（全体管理者のみ）
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>("/auth/me");
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

// 全体管理者は全テナント、それ以外は自分のテナントだけが返る
export async function listTenants(): Promise<Tenant[]> {
  const { data } = await api.get<Tenant[]>("/tenants");
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
