import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  apiErrorMessage,
  formatDateTime,
  getActiveTenant,
  getMe,
  isTransientError,
  listDocuments,
  listTenants,
  OCR_LABEL,
  setActiveTenant,
  uploadDocument,
  type CaptureMode,
  type DocumentRead,
  type Tenant,
  type UploadPage,
} from "../api/client";
import { CaptureModal, type CaptureStep } from "../components/CaptureModal";
import { DocThumb } from "../components/DocThumb";
import { enqueueUpload, flushQueue, pendingCount } from "../offline";
import { colors, radius } from "../theme";

const RECENT_COUNT = 5;

// 撮影タブの最初の画面（ストクルのスキャン画面と同じく、ボタンを押してからカメラを開く）。
// 撮影・取込 (F-01/F-02/F-10/F-11) と、自分が最近登録した書類の一覧
export function CameraScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [myId, setMyId] = useState<string | null>(null);
  const [recent, setRecent] = useState<DocumentRead[] | null>(null);
  // 開いている撮影モーダル（null = 閉じている）
  const [capture, setCapture] = useState<{ pages: UploadPage[]; step: CaptureStep } | null>(null);
  // 登録後に画面の上へ出すお知らせ
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  // 全体管理者のときだけ選択肢を持つ（null = 一般ユーザー。自分のテナント固定）
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [tenant, setTenant] = useState<string | null>(getActiveTenant());
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    // 起動時に未送信キューを自動再送し、残件数を表示 (F-11)
    flushQueue().then(({ remaining }) => setPending(remaining)).catch(() => {});
  }, []);

  useEffect(() => {
    getMe()
      .then(async (u) => {
        setMyId(u.id);
        // 全体管理者はテナント未所属のため、登録先テナントを選ばせる（Web の TenantSwitcher と同じ）
        if (u.role !== "super_admin") return;
        const list = await listTenants();
        setTenants(list);
        if (!getActiveTenant() && list.length === 1) {
          setActiveTenant(list[0].id);
          setTenant(list[0].id);
        }
      })
      .catch(() => setRecent([]));
  }, []);

  // 自分が登録した書類を新しい順に（一覧 API は created_at の降順）
  const loadRecent = useCallback(() => {
    if (!myId) return;
    listDocuments()
      .then((docs) => setRecent(docs.filter((d) => d.owner_id === myId).slice(0, RECENT_COUNT)))
      .catch(() => setRecent((prev) => prev ?? []));
  }, [myId]);

  useFocusEffect(loadRecent);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function chooseTenant(id: string) {
    setActiveTenant(id);
    setTenant(id);
    setPicking(false);
    loadRecent();
  }

  // 全体管理者で登録先が未選択なら、選択シートを開いて true を返す
  function needTenant() {
    if (tenants && !tenant) {
      setPicking(true);
      return true;
    }
    return false;
  }

  function openCamera() {
    if (needTenant()) return;
    setCapture({ pages: [], step: "camera" });
  }

  // ピッカーはモーダルの上では開かず、この画面から開いて確認画面に渡す
  async function pickFromLibrary() {
    if (needTenant()) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!res.canceled && res.assets.length > 0) {
      const pages = res.assets.map((a) => ({ uri: a.uri, type: a.mimeType ?? "image/jpeg" }));
      setCapture({ pages, step: "review" });
    }
  }

  async function pickPdf() {
    if (needTenant()) return;
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const f = res.assets[0];
    // PDFは単独で1ドキュメントとしてアップロード
    setCapture({ pages: [{ uri: f.uri, name: f.name ?? "document.pdf", type: "application/pdf" }], step: "review" });
  }

  async function submit(title: string, pages: UploadPage[], mode: CaptureMode) {
    const pdf = pages.some((p) => p.type === "application/pdf");
    // 空欄は自動命名にする。OCR の後に本文の見出しで置き換わる（backend analyze.py の AUTO_TITLE_RE）
    const finalTitle = title.trim() || `${pdf ? "取込" : "資料"}_${Date.now()}`;
    try {
      await uploadDocument(finalTitle, pages, mode);
      setCapture(null);
      setNotice({ text: "登録しました。文字の読み取りが終わると家族にお知らせします。", tone: "ok" });
      loadRecent();
    } catch (e) {
      if (!isTransientError(e)) {
        // サーバーが受け付けなかった（4xx）→ 再送しても通らないので理由を出し、確認画面に残す
        Alert.alert("アップロードできませんでした", apiErrorMessage(e, "アップロードに失敗しました。"));
        return;
      }
      // オフライン等 → 端末に退避して後で同期 (F-11)
      try {
        await enqueueUpload(finalTitle, pages, mode);
        setPending(await pendingCount());
        setCapture(null);
        setNotice({ text: "通信できないため端末に保存しました。接続後に自動送信します。", tone: "warn" });
      } catch {
        Alert.alert("エラー", "アップロードに失敗しました。");
      }
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const { sent, remaining, error } = await flushQueue();
      setPending(remaining);
      if (sent > 0) {
        Alert.alert("同期", `${sent}件を送信しました。`);
        loadRecent();
      } else if (error && !isTransientError(error)) Alert.alert("同期", apiErrorMessage(error, "送信できませんでした。"));
      else Alert.alert("同期", "送信できませんでした。接続を確認してください。");
    } finally {
      setBusy(false);
    }
  }

  const tenantName = tenants?.find((t) => t.id === tenant)?.name;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {notice && (
          <View style={[styles.notice, notice.tone === "warn" && styles.noticeWarn]}>
            <Ionicons
              name={notice.tone === "ok" ? "checkmark-circle" : "cloud-offline-outline"}
              size={18}
              color={notice.tone === "ok" ? colors.success : colors.warning}
            />
            <Text style={[styles.noticeText, notice.tone === "warn" && { color: colors.warning }]}>{notice.text}</Text>
          </View>
        )}

        {pending > 0 && (
          <TouchableOpacity style={styles.pending} onPress={syncNow} disabled={busy}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.warning} />
            <Text style={styles.pendingText}>未送信 {pending}件</Text>
            {busy ? <ActivityIndicator color={colors.warning} /> : <Text style={styles.pendingAction}>同期する</Text>}
          </TouchableOpacity>
        )}

        {tenants && (
          <TouchableOpacity style={styles.tenant} onPress={() => setPicking(true)}>
            <Ionicons name="business-outline" size={18} color={colors.textMuted} />
            <Text style={styles.tenantLabel}>登録先</Text>
            <Text style={[styles.tenantName, !tenantName && { color: colors.textSubtle }]} numberOfLines={1}>
              {tenantName ?? "選択してください"}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSubtle} />
          </TouchableOpacity>
        )}

        {/* ボタンを押してからカメラを開く（ストクルと同じ） */}
        <View style={styles.hero}>
          <View style={styles.ring}>
            <Pressable
              onPress={openCamera}
              accessibilityRole="button"
              accessibilityLabel="撮影する"
              style={({ pressed }) => [styles.bigBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            >
              <Ionicons name="camera" size={40} color="#fff" />
              <Text style={styles.bigBtnText}>撮影する</Text>
            </Pressable>
          </View>
          <Text style={styles.heroHint}>ボタンを押すとカメラが起動します</Text>
          <View style={styles.subRow}>
            <TouchableOpacity style={styles.subBtn} onPress={pickFromLibrary}>
              <Ionicons name="images-outline" size={18} color={colors.primary} />
              <Text style={styles.subBtnText}>写真から選ぶ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.subBtn} onPress={pickPdf}>
              <Ionicons name="document-attach-outline" size={18} color={colors.primary} />
              <Text style={styles.subBtnText}>PDFを取り込む</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 自分が最近登録した書類 */}
        <View style={styles.sectionHead}>
          <Text style={styles.section}>最近登録した書類</Text>
          <TouchableOpacity onPress={() => navigation.navigate("Documents")} hitSlop={8}>
            <Text style={styles.sectionLink}>すべて見る</Text>
          </TouchableOpacity>
        </View>
        {recent === null ? (
          <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} />
        ) : recent.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={32} color={colors.textSubtle} />
            <Text style={styles.emptyText}>まだ登録した書類はありません。{"\n"}撮影すると、ここにタイトルとサムネイルが並びます。</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {recent.map((d, i) => (
              <TouchableOpacity
                key={d.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                onPress={() => navigation.navigate("Detail", { id: d.id, title: d.title })}
              >
                <DocThumb id={d.id} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{d.title}</Text>
                  <Text style={styles.rowMeta}>
                    {formatDateTime(d.created_at)}
                    {d.ocr_status !== "done" ? ` · ${OCR_LABEL[d.ocr_status] ?? d.ocr_status}` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.border} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <CaptureModal
        visible={capture !== null}
        initialPages={capture?.pages ?? NO_PAGES}
        initialStep={capture?.step ?? "camera"}
        onSubmit={submit}
        onClose={() => setCapture(null)}
      />

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

// 閉じているときに毎回新しい配列を渡すと、モーダルの初期化が走り続けるため固定する
const NO_PAGES: UploadPage[] = [];

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 32 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },
  noticeWarn: { backgroundColor: colors.warningSoft },
  noticeText: { flex: 1, color: colors.success, fontSize: 13, fontWeight: "600" },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  pendingText: { flex: 1, color: colors.warning, fontWeight: "700", fontSize: 14 },
  pendingAction: { color: colors.warning, fontWeight: "700", fontSize: 14 },
  tenant: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  tenantLabel: { color: colors.textMuted, fontSize: 14 },
  tenantName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600", textAlign: "right" },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: "center",
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  ring: { padding: 10, borderRadius: 100, backgroundColor: colors.primarySoft },
  bigBtn: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  bigBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  heroHint: { color: colors.textSubtle, fontSize: 13, marginTop: 14 },
  subRow: { flexDirection: "row", gap: 10, marginTop: 18, alignSelf: "stretch" },
  subBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  subBtnText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  sectionLink: { fontSize: 13, fontWeight: "600", color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  thumb: { width: 44, height: 58, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text, lineHeight: 20 },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  empty: { backgroundColor: colors.surface, borderRadius: radius.lg, alignItems: "center", gap: 10, padding: 24 },
  emptyText: { color: colors.textSubtle, fontSize: 13, textAlign: "center", lineHeight: 19 },

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
