import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const TOKEN_KEY = "access_token";

export const api = axios.create({
  baseURL: `${baseURL}/api/v1`,
});

// JWT を付与
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
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

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

export async function getDocument(id: string): Promise<DocumentRead> {
  const { data } = await api.get<DocumentRead>(`/documents/${id}`);
  return data;
}

export async function listVersions(id: string): Promise<DocumentVersion[]> {
  const { data } = await api.get<DocumentVersion[]>(`/documents/${id}/versions`);
  return data;
}

export async function logPrint(id: string): Promise<void> {
  await api.post(`/documents/${id}/print-log`);
}

// OCRで認識した文字を集約したPDF（全文）をダウンロードする (F-13/F-14系)
export async function downloadOcrTextPdf(id: string, title: string): Promise<void> {
  const r = await api.get(`/documents/${id}/ocr-pdf`, { responseType: "blob" });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ocr_text_${title || id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- ユーザー・権限のマスタ管理 (F-35, F-38) ----

export type Role = "admin" | "registrar" | "viewer";
export type PermissionLevel = "view" | "edit" | "delete";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
}

export interface UserCreate {
  email: string;
  name: string;
  role: Role;
  password: string;
}

export interface UserUpdate {
  name?: string;
  role?: Role;
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

// ---- 既読 (F-32) ----

export interface ReadReceipt {
  user_id: string;
  user_name: string;
  user_email: string;
  read_at: string;
}

export async function listReadReceipts(docId: string): Promise<ReadReceipt[]> {
  const { data } = await api.get<ReadReceipt[]>(`/documents/${docId}/reads`);
  return data;
}
