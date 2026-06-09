import axios from "axios";

// 端末からはホストのIP/ドメインを指定する（エミュレータでは適宜変更）
// 実機テスト用に開発機の LAN IP を既定値にしている。環境ごとに EXPO_PUBLIC_API_BASE_URL で上書き可。
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://192.168.100.165:8000";

// 認証付きでファイル(画像/PDF)を直接ダウンロードする画面が、URL とトークンを組み立てるのに使う。
export const API_V1_BASE = `${BASE_URL}/api/v1`;

export const api = axios.create({
  baseURL: API_V1_BASE,
});

let token: string | null = null;
export function setToken(t: string) {
  token = t;
}
export function clearToken() {
  token = null;
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
