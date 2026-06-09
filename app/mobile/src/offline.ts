// オフライン撮影と再接続時の自動同期 (F-11)。
// アップロードに失敗したドキュメントを端末に退避し、後で再送する簡易キュー。
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { uploadDocument, type CaptureMode, type UploadPage } from "./api/client";

const QUEUE_KEY = "dms_pending_uploads";
const DIR = `${FileSystem.documentDirectory}pending/`;

interface PendingItem {
  id: string;
  title: string;
  mode: CaptureMode;
  files: string[]; // 永続化したページのローカルuri
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
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const files: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const dest = `${DIR}${id}_${i}.jpg`;
    try {
      await FileSystem.copyAsync({ from: pages[i].uri, to: dest });
      files.push(dest);
    } catch {
      // コピー失敗時は元uriのまま積む（次回再送で解決する場合がある）
      files.push(pages[i].uri);
    }
  }
  const items = await readQueue();
  items.push({ id, title, mode, files, createdAt: Date.now() });
  await writeQueue(items);
}

// キューを順次再送する。成功した分だけ削除し、最初の失敗で停止する。
// 戻り値: { sent, remaining }
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  const items = await readQueue();
  let sent = 0;
  for (const item of items) {
    try {
      const pages: UploadPage[] = item.files.map((uri, i) => ({
        uri,
        name: `page_${i}.jpg`,
        type: "image/jpeg",
      }));
      await uploadDocument(item.title, pages, item.mode);
      // 成功 → ファイル削除
      await Promise.all(item.files.map((f) => FileSystem.deleteAsync(f, { idempotent: true })));
      sent += 1;
    } catch {
      break; // まだオフライン等。残りは次回。
    }
  }
  if (sent > 0) {
    const remaining = items.slice(sent);
    await writeQueue(remaining);
    return { sent, remaining: remaining.length };
  }
  return { sent: 0, remaining: items.length };
}
