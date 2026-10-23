// オフライン撮影と再接続時の自動同期 (F-11)。
// アップロードに失敗したドキュメントを端末に退避し、後で再送する簡易キュー。
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { uploadDocument, type CaptureMode, type UploadPage } from "./api/client";

const QUEUE_KEY = "dms_pending_uploads";
const pendingDir = () => new Directory(Paths.document, "pending");

interface PendingItem {
  id: string;
  title: string;
  mode: CaptureMode;
  files: string[]; // 永続化したページのローカルuri
  // 各ページの元ファイル名/MIME（PDF取込を JPEG として再送しないため）。旧形式のキューには無い
  meta?: { name?: string; type?: string }[];
  createdAt: number;
}

async function readQueue(): Promise<PendingItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingItem[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

// ページ画像を永続ディレクトリにコピーしてキューに積む。
export async function enqueueUpload(
  title: string,
  pages: UploadPage[],
  mode: CaptureMode
): Promise<void> {
  const dir = pendingDir();
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    // 作れなくても各ページのコピー失敗として扱う
  }
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const files: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const ext = pages[i].type === "application/pdf" ? "pdf" : "jpg";
    const dest = new File(dir, `${id}_${i}.${ext}`);
    try {
      await new File(pages[i].uri).copy(dest, { overwrite: true });
      files.push(dest.uri);
    } catch {
      // コピー失敗時は元uriのまま積む（次回再送で解決する場合がある）
      files.push(pages[i].uri);
    }
  }
  const meta = pages.map((p) => ({ name: p.name, type: p.type }));
  const items = await readQueue();
  items.push({ id, title, mode, files, meta, createdAt: Date.now() });
  await writeQueue(items);
}

// キューを順次再送する。成功した分だけ削除し、最初の失敗で停止する。
// 戻り値: { sent, remaining, error }（error は停止の原因。表示に使う）
export async function flushQueue(): Promise<{ sent: number; remaining: number; error?: unknown }> {
  const items = await readQueue();
  let sent = 0;
  let error: unknown;
  for (const item of items) {
    try {
      const pages: UploadPage[] = item.files.map((uri, i) => ({
        uri,
        name: item.meta?.[i]?.name ?? `page_${i}.jpg`,
        type: item.meta?.[i]?.type ?? "image/jpeg",
      }));
      await uploadDocument(item.title, pages, item.mode);
      // 成功 → ファイル削除
      for (const f of item.files) {
        try {
          const file = new File(f);
          if (file.exists) file.delete();
        } catch {
          // 消せなくても再送済みなのでキューからは外す
        }
      }
      sent += 1;
    } catch (e) {
      error = e;
      break; // まだオフライン等。残りは次回。
    }
  }
  if (sent > 0) {
    const remaining = items.slice(sent);
    await writeQueue(remaining);
    return { sent, remaining: remaining.length, error };
  }
  return { sent: 0, remaining: items.length, error };
}
