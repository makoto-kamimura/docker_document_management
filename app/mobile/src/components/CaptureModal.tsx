import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { CaptureMode, UploadPage } from "../api/client";
import { colors, radius } from "../theme";

const MODES: { key: CaptureMode; label: string }[] = [
  { key: "color", label: "カラー" },
  { key: "gray", label: "グレー" },
  { key: "bw", label: "白黒" },
];

export type CaptureStep = "camera" | "review";

const isPdf = (p: UploadPage) => p.type === "application/pdf";

// 撮影 → 確認（タイトル・モード・ページ）→ 登録 の全画面モーダル (F-01/F-02/F-06/F-08/F-09)。
// ストクルのスキャン画面と同じく、撮影タブのボタンから開いて「閉じる」で戻る。
// モーダルを重ねないよう、撮影と確認は同じモーダルの中で切り替える。
export function CaptureModal({
  visible,
  initialPages,
  initialStep,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  initialPages: UploadPage[];
  initialStep: CaptureStep;
  // 登録できたら呼び出し側がモーダルを閉じる。失敗時は確認画面に残る
  onSubmit: (title: string, pages: UploadPage[], mode: CaptureMode) => Promise<void>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<CaptureStep>(initialStep);
  const [pages, setPages] = useState<UploadPage[]>(initialPages);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<CaptureMode>("color");
  const [submitting, setSubmitting] = useState(false);

  // 開くたびに初期状態へ戻す
  useEffect(() => {
    if (!visible) return;
    setStep(initialStep);
    setPages(initialPages);
    setTitle("");
    setMode("color");
  }, [visible, initialStep, initialPages]);

  const pdf = pages.some(isPdf);

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

  function close() {
    if (submitting) return;
    if (pages.length === 0) return onClose();
    Alert.alert("登録せずに閉じますか？", `${pages.length}ページは保存されません。`, [
      { text: "キャンセル", style: "cancel" },
      { text: "閉じる", style: "destructive", onPress: onClose },
    ]);
  }

  async function submit() {
    if (pages.length === 0) {
      Alert.alert("ページがありません", "撮影またはライブラリ/PDFから追加してください。");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(title, pages, mode);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {step === "camera" ? (
        <View style={styles.camRoot}>
          <View style={[styles.camHeader, { paddingTop: insets.top + 8 }]}>
            <Text style={styles.camTitle}>撮影{pages.length > 0 ? `（${pages.length}枚）` : ""}</Text>
            <TouchableOpacity onPress={close} hitSlop={10}>
              <Text style={styles.camClose}>閉じる</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.camBody}>
            {!permission ? (
              <ActivityIndicator color="#fff" />
            ) : !permission.granted ? (
              <View style={styles.permission}>
                <Ionicons name="camera-outline" size={40} color="rgba(255,255,255,0.6)" />
                <Text style={styles.permText}>カメラの利用許可が必要です。</Text>
                <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
                  <Text style={styles.permBtnText}>許可する</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} />
            )}
          </View>

          <View style={[styles.camBottom, { paddingBottom: insets.bottom + 16 }]}>
            {pages.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.camThumbs}>
                {pages.map((p, i) => (
                  <View key={`${p.uri}_${i}`}>
                    <Image source={{ uri: p.uri }} style={styles.camThumb} />
                    <TouchableOpacity style={styles.del} onPress={() => removePage(i)} hitSlop={8} accessibilityLabel="削除">
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.controls}>
              <View style={styles.controlSide} />
              <TouchableOpacity
                style={styles.shutter}
                onPress={capture}
                disabled={!permission?.granted}
                accessibilityLabel="シャッター"
              >
                <View style={styles.shutterInner} />
              </TouchableOpacity>
              <View style={styles.controlSide}>
                <TouchableOpacity
                  style={[styles.next, pages.length === 0 && { opacity: 0.4 }]}
                  onPress={() => setStep("review")}
                  disabled={pages.length === 0}
                >
                  <Text style={styles.nextText}>次へ</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.revRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.revHeader, { paddingTop: insets.top + 8 }]}>
            <View style={styles.revSide}>
              {!pdf && (
                <TouchableOpacity style={styles.back} onPress={() => setStep("camera")} hitSlop={10} disabled={submitting}>
                  <Ionicons name="chevron-back" size={18} color={colors.primary} />
                  <Text style={styles.backText}>撮影</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.revTitle}>登録</Text>
            <View style={[styles.revSide, { alignItems: "flex-end" }]}>
              <TouchableOpacity onPress={close} hitSlop={10} disabled={submitting}>
                <Text style={styles.backText}>閉じる</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.revBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>タイトル</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="例: 運動会のお知らせ"
              placeholderTextColor={colors.textSubtle}
              autoFocus
              returnKeyType="done"
              maxLength={200}
            />
            <Text style={styles.help}>空欄なら、読み取った見出しから自動で付けます。</Text>

            {!pdf && (
              <>
                <Text style={styles.label}>読み取りの色</Text>
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
              </>
            )}

            <Text style={styles.label}>ページ（{pages.length}）</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.revThumbs}>
              {pages.map((p, i) => (
                <View key={`${p.uri}_${i}`} style={{ alignItems: "center" }}>
                  {isPdf(p) ? (
                    <View style={[styles.revThumb, styles.pdfTile]}>
                      <Ionicons name="document-text-outline" size={26} color={colors.primary} />
                      <Text style={styles.pdfName} numberOfLines={2}>{p.name ?? "PDF"}</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: p.uri }} style={styles.revThumb} />
                  )}
                  <Text style={styles.pageNo}>{i + 1}</Text>
                  <TouchableOpacity style={styles.del} onPress={() => removePage(i)} hitSlop={8} accessibilityLabel="削除">
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                  {pages.length > 1 && (
                    <View style={styles.move}>
                      <TouchableOpacity onPress={() => movePage(i, -1)} hitSlop={6} accessibilityLabel="前へ">
                        <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => movePage(i, 1)} hitSlop={6} accessibilityLabel="後ろへ">
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </ScrollView>

          <View style={[styles.revFooter, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={[styles.submit, (submitting || pages.length === 0) && { opacity: 0.6 }]}
              onPress={submit}
              disabled={submitting || pages.length === 0}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>登録する</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  camRoot: { flex: 1, backgroundColor: "#000" },
  camHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  camTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  camClose: { color: "#93c5fd", fontSize: 15 },
  camBody: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  permission: { alignItems: "center", gap: 12, paddingHorizontal: 32 },
  permText: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  permBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 24, paddingVertical: 12 },
  permBtnText: { color: "#fff", fontWeight: "700" },
  camBottom: { paddingTop: 12, gap: 14 },
  camThumbs: { paddingHorizontal: 16, gap: 10 },
  camThumb: { width: 48, height: 64, borderRadius: radius.sm, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.9)", backgroundColor: "#334155" },
  controls: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20 },
  controlSide: { flex: 1, alignItems: "flex-end" },
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
  next: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#fff",
    borderRadius: radius.pill,
    paddingLeft: 16,
    paddingRight: 10,
    paddingVertical: 10,
  },
  nextText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  del: {
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

  revRoot: { flex: 1, backgroundColor: colors.bg },
  revHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.bg,
  },
  revSide: { flex: 1 },
  revTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  back: { flexDirection: "row", alignItems: "center" },
  backText: { color: colors.primary, fontSize: 16 },
  revBody: { padding: 16, paddingBottom: 24 },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: 12, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  help: { fontSize: 12, color: colors.textSubtle, marginTop: 6 },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: "center" },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { color: colors.textMuted, fontWeight: "600", fontSize: 14 },
  segTextActive: { color: colors.primary, fontWeight: "700" },
  revThumbs: { gap: 14, paddingTop: 6, paddingRight: 8 },
  revThumb: { width: 84, height: 112, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  pdfTile: { alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pdfName: { fontSize: 10, color: colors.textMuted, textAlign: "center" },
  pageNo: { fontSize: 12, fontWeight: "700", color: colors.textMuted, marginTop: 6 },
  move: { flexDirection: "row", gap: 16, marginTop: 2 },
  revFooter: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  submit: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
