import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  apiErrorMessage,
  getActiveTenant,
  getMe,
  isTransientError,
  listTenants,
  setActiveTenant,
  uploadDocument,
  type CaptureMode,
  type Tenant,
  type UploadPage,
} from "../api/client";
import { enqueueUpload, flushQueue, pendingCount } from "../offline";
import { colors, radius } from "../theme";

const MODES: { key: CaptureMode; label: string }[] = [
  { key: "color", label: "カラー" },
  { key: "gray", label: "グレー" },
  { key: "bw", label: "白黒" },
];

// 撮影・取り込み (F-01/F-02/F-06/F-08/F-09/F-10/F-11)
export function CameraScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  // 別のタブにいる間はカメラを止める
  const focused = useIsFocused();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [pages, setPages] = useState<UploadPage[]>([]);
  const [mode, setMode] = useState<CaptureMode>("color");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  // 全体管理者のときだけ選択肢を持つ（null = 一般ユーザー。自分のテナント固定）
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [tenant, setTenant] = useState<string | null>(getActiveTenant());
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    // 起動時に未送信キューを自動再送し、残件数を表示 (F-11)
    flushQueue().then(({ remaining }) => setPending(remaining)).catch(() => {});
  }, []);

  useEffect(() => {
    // 全体管理者はテナント未所属のため、登録先テナントを選ばせる（Web の TenantSwitcher と同じ）
    getMe()
      .then(async (u) => {
        if (u.role !== "super_admin") return;
        const list = await listTenants();
        setTenants(list);
        if (!getActiveTenant() && list.length === 1) {
          setActiveTenant(list[0].id);
          setTenant(list[0].id);
        }
      })
      .catch(() => {});
  }, []);

  if (!permission) return <View style={styles.root} />;
  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center]}>
        <Ionicons name="camera-outline" size={44} color="rgba(255,255,255,0.6)" />
        <Text style={styles.permTitle}>カメラの利用許可が必要です</Text>
        <Text style={styles.permText}>紙の資料を撮影するためにカメラを使います。</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>許可する</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function capture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync();
    if (!photo) return;
    // 画質チェック: 低解像度を警告 (F-09)
    if (photo.width && Math.min(photo.width, photo.height) < 1000) {
      Alert.alert("低解像度の可能性", "解像度が低い可能性があります。明るい場所で近づいて再撮影すると精度が上がります。");
    }
    setPages((prev) => [...prev, { uri: photo.uri, type: "image/jpeg" }]);
  }

  async function pickFromLibrary() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!res.canceled) {
      const added = res.assets.map((a) => ({ uri: a.uri, type: a.mimeType ?? "image/jpeg" }));
      setPages((prev) => [...prev, ...added]);
    }
  }

  async function pickPdf() {
    // ピッカーを閉じた直後はシートを出せないため、登録先は先に確認する
    if (needTenant()) return;
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const f = res.assets[0];
    // PDFは単独で1ドキュメントとしてアップロード
    await save([{ uri: f.uri, name: f.name ?? "document.pdf", type: "application/pdf" }], `取込_${Date.now()}`);
  }

  function movePage(index: number, dir: -1 | 1) {
    setPages((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function removePage(index: number) {
    setPages((prev) => prev.filter((_, i) => i !== index));
  }

  function chooseTenant(id: string) {
    setActiveTenant(id);
    setTenant(id);
    setPicking(false);
  }

  // 全体管理者で登録先が未選択なら、選択シートを開いて true を返す
  function needTenant() {
    if (tenants && !tenant) {
      setPicking(true);
      return true;
    }
    return false;
  }

  async function save(items?: UploadPage[], titleOverride?: string) {
    const target = items ?? pages;
    if (target.length === 0) {
      Alert.alert("ページがありません", "撮影またはライブラリ/PDFから追加してください。");
      return;
    }
    if (needTenant()) return;
    setBusy(true);
    const title = titleOverride ?? `資料_${Date.now()}`;
    try {
      await uploadDocument(title, target, mode);
      Alert.alert("アップロード完了", "文字の読み取りを始めました。読み取りが終わると家族にお知らせします。");
      setPages([]);
      navigation.navigate("Documents");
    } catch (e) {
      if (!isTransientError(e)) {
        // サーバーが受け付けなかった（4xx）→ 再送しても通らないので理由を出し、ページは残す
        Alert.alert("アップロードできませんでした", apiErrorMessage(e, "アップロードに失敗しました。"));
        return;
      }
      // オフライン等 → 端末に退避して後で同期 (F-11)
      try {
        await enqueueUpload(title, target, mode);
        setPending(await pendingCount());
        setPages([]);
        Alert.alert("オフライン保存", "通信できないため端末に保存しました。接続後に自動送信します。");
      } catch {
        Alert.alert("エラー", "アップロードに失敗しました。");
      }
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const { sent, remaining, error } = await flushQueue();
      setPending(remaining);
      if (sent > 0) Alert.alert("同期", `${sent}件を送信しました。`);
      else if (error && !isTransientError(error)) Alert.alert("同期", apiErrorMessage(error, "送信できませんでした。"));
      else Alert.alert("同期", "送信できませんでした。接続を確認してください。");
    } finally {
      setBusy(false);
    }
  }

  const tenantName = tenants?.find((t) => t.id === tenant)?.name;

  return (
    <View style={styles.root}>
      {focused && <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} />}

      {/* 上: モード (F-06) / 登録先（全体管理者のみ） / 未送信 (F-11) */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={styles.segment}>
          {MODES.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.segBtn, mode === m.key && styles.segBtnActive]}
              onPress={() => setMode(m.key)}
            >
              <Text style={[styles.segText, mode === m.key && styles.segTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {(tenants || pending > 0) && (
          <View style={styles.pills}>
            {tenants && (
              <TouchableOpacity style={styles.pill} onPress={() => setPicking(true)}>
                <Ionicons name="business-outline" size={14} color="#fff" />
                <Text style={styles.pillText} numberOfLines={1}>{tenantName ?? "登録先を選択"}</Text>
                <Ionicons name="chevron-down" size={14} color="#fff" />
              </TouchableOpacity>
            )}
            {pending > 0 && (
              <TouchableOpacity style={[styles.pill, styles.pillWarn]} onPress={syncNow} disabled={busy}>
                <Ionicons name="cloud-upload-outline" size={15} color={colors.text} />
                <Text style={[styles.pillText, { color: colors.text }]}>未送信 {pending}件・同期</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {busy && pages.length === 0 && (
        <View style={styles.busy}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}

      {/* 下: ページ (F-02/F-08) / 保存 / 操作 */}
      <View style={styles.bottom}>
        {pages.length > 0 && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
              {pages.map((p, i) => (
                <View key={`${p.uri}_${i}`} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Text style={styles.thumbIdx}>{i + 1}</Text>
                  <TouchableOpacity style={styles.thumbDel} onPress={() => removePage(i)} hitSlop={8} accessibilityLabel="削除">
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.thumbMove}>
                    <TouchableOpacity onPress={() => movePage(i, -1)} hitSlop={6} accessibilityLabel="前へ">
                      <Ionicons name="chevron-back" size={14} color="rgba(255,255,255,0.8)" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => movePage(i, 1)} hitSlop={6} accessibilityLabel="後ろへ">
                      <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.8)" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={[styles.save, busy && { opacity: 0.7 }]} onPress={() => save()} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>保存 · {pages.length}ページ</Text>}
            </TouchableOpacity>
          </>
        )}

        <View style={styles.controls}>
          <TouchableOpacity style={styles.side} onPress={pickFromLibrary} disabled={busy}>
            <View style={styles.sideIcon}>
              <Ionicons name="images-outline" size={22} color="#fff" />
            </View>
            <Text style={styles.sideText}>ライブラリ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shutter} onPress={capture} disabled={busy} accessibilityLabel="撮影">
            <View style={styles.shutterInner} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.side} onPress={pickPdf} disabled={busy}>
            <View style={styles.sideIcon}>
              <Ionicons name="document-attach-outline" size={22} color="#fff" />
            </View>
            <Text style={styles.sideText}>PDF</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 登録先テナントの選択シート（全体管理者のみ） */}
      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <View style={styles.sheetRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicking(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>登録先のテナント</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {tenants?.map((t) => (
                <TouchableOpacity key={t.id} style={styles.sheetRow} onPress={() => chooseTenant(t.id)}>
                  <Text style={styles.sheetRowText}>
                    {t.name}
                    {t.is_demo ? "（デモ）" : ""}
                  </Text>
                  {tenant === t.id && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                </TouchableOpacity>
              ))}
              {tenants?.length === 0 && <Text style={styles.sheetEmpty}>テナントがありません。</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.camera },
  center: { justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  permTitle: { color: "#fff", fontSize: 17, fontWeight: "700", marginTop: 16 },
  permText: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 6, textAlign: "center" },
  permBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 28, paddingVertical: 13, marginTop: 24 },
  permBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  top: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", gap: 8 },
  segment: { flexDirection: "row", backgroundColor: colors.overlay, borderRadius: radius.pill, padding: 3 },
  segBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.pill },
  segBtnActive: { backgroundColor: "#fff" },
  segText: { color: "rgba(255,255,255,0.85)", fontWeight: "600", fontSize: 13 },
  segTextActive: { color: colors.text },
  pills: { flexDirection: "row", gap: 8, paddingHorizontal: 16 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillWarn: { backgroundColor: "#fbbf24" },
  pillText: { color: "#fff", fontWeight: "600", fontSize: 13, flexShrink: 1 },

  busy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 16, gap: 12 },
  thumbs: { paddingHorizontal: 16, gap: 10 },
  thumbWrap: { alignItems: "center" },
  thumb: { width: 54, height: 72, borderRadius: radius.sm, backgroundColor: "#334155", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.9)" },
  thumbIdx: {
    position: "absolute",
    top: 4,
    left: 6,
    color: "#fff",
    fontWeight: "700",
    fontSize: 11,
    textShadowColor: "#000",
    textShadowRadius: 3,
  },
  thumbDel: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbMove: { flexDirection: "row", gap: 12, marginTop: 4 },
  save: {
    marginHorizontal: 16,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
  side: { alignItems: "center", gap: 6, width: 72 },
  sideIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
  },
  sideText: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "600" },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" },

  sheetRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sheetHandle: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginBottom: 8 },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetRowText: { fontSize: 16, color: colors.text },
  sheetEmpty: { color: colors.textMuted, paddingVertical: 16 },
});
