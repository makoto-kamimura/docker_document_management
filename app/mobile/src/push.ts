// プッシュ通知の登録（準備）。EAS の projectId が設定されたアプリでだけ有効になる。
// 未設定なら何もしない（アプリ内通知のみで動く）。設定方法は app/mobile/README.md を参照。
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken } from "./api/client";

export function pushProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export const pushEnabled = !!pushProjectId();

if (pushEnabled) {
  // アプリを開いている間に届いた通知もバナー表示する
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// ログイン後に呼ぶ。許可ダイアログ → Expo Push Token 取得 → サーバーへ登録
export async function registerForPush(): Promise<void> {
  const projectId = pushProjectId();
  if (!projectId) return;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(data, Platform.OS);
  } catch {
    // シミュレータ等でトークンを取得できない場合はアプリ内通知のみ
  }
}

// ログイン前・起動前にタップされた通知の書類。ログイン後に takePendingDocument() で開く
let pendingDocId: string | null = null;
export function takePendingDocument(): string | null {
  const id = pendingDocId;
  pendingDocId = null;
  return id;
}

function documentIdOf(res: Notifications.NotificationResponse | null): string | null {
  const id = res?.notification.request.content.data?.document_id;
  return typeof id === "string" ? id : null;
}

// 通知をタップしたときに対象の書類を開く。open が false を返したら（未ログイン等）ログイン後に開く。解除関数を返す
export function onPushOpened(open: (documentId: string) => boolean): () => void {
  if (!pushEnabled) return () => {};
  Notifications.getLastNotificationResponseAsync()
    .then((res) => { pendingDocId = documentIdOf(res); })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const id = documentIdOf(res);
    if (id && !open(id)) pendingDocId = id;
  });
  return () => sub.remove();
}
