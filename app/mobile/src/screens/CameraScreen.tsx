import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { uploadDocument, type CaptureMode, type UploadPage } from "../api/client";
import { enqueueUpload, flushQueue, pendingCount } from "../offline";

const MODES: { key: CaptureMode; label: string }[] = [
  { key: "color", label: "カラー" },
  { key: "gray", label: "グレー" },
  { key: "bw", label: "白黒" },
];

// 撮影・取り込み (F-01/F-02/F-06/F-08/F-09/F-10/F-11)
export function CameraScreen() {
  const navigation = useNavigation<any>();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [pages, setPages] = useState<UploadPage[]>([]);
  const [mode, setMode] = useState<CaptureMode>("color");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    // 起動時に未送信キューを自動再送 (F-11)
    flushQueue().then(({ remaining }) => setPending(remaining)).catch(() => {});
    pendingCount().then(setPending).catch(() => {});
  }, []);

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text>カメラの利用許可が必要です。</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>許可する</Text>
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

  async function save(items?: UploadPage[], titleOverride?: string) {
    const target = items ?? pages;
    if (target.length === 0) {
      Alert.alert("ページがありません", "撮影またはライブラリ/PDFから追加してください。");
      return;
    }
    setBusy(true);
    const title = titleOverride ?? `資料_${Date.now()}`;
    try {
      await uploadDocument(title, target, mode);
      Alert.alert("アップロード完了", "OCR処理を開始しました。");
      setPages([]);
      navigation.navigate("Documents");
    } catch (e) {
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
      const { sent, remaining } = await flushQueue();
      setPending(remaining);
      Alert.alert("同期", sent > 0 ? `${sent}件を送信しました。` : "送信できませんでした。接続を確認してください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
      {/* モード選択 (F-06) */}
      <View style={styles.modeBar}>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.modeBtn, mode === m.key && styles.modeBtnActive]}
            onPress={() => setMode(m.key)}
          >
            <Text style={[styles.modeText, mode === m.key && styles.modeTextActive]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <CameraView ref={cameraRef} style={{ flex: 1 }} />

      {pending > 0 && (
        <TouchableOpacity style={styles.syncBar} onPress={syncNow} disabled={busy}>
          <Text style={styles.syncText}>未送信 {pending} 件を同期 ›</Text>
        </TouchableOpacity>
      )}

      {/* ページサムネイル列 (F-02/F-08) */}
      {pages.length > 0 && (
        <ScrollView horizontal style={styles.thumbs} contentContainerStyle={{ alignItems: "center", padding: 8 }}>
          {pages.map((p, i) => (
            <View key={`${p.uri}_${i}`} style={styles.thumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <Text style={styles.thumbIdx}>{i + 1}</Text>
              <TouchableOpacity style={styles.thumbDel} onPress={() => removePage(i)}>
                <Text style={styles.thumbDelText}>×</Text>
              </TouchableOpacity>
              <View style={styles.thumbMove}>
                <TouchableOpacity onPress={() => movePage(i, -1)}><Text style={styles.moveText}>◀</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => movePage(i, 1)}><Text style={styles.moveText}>▶</Text></TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 操作ボタン */}
      <View style={styles.bar}>
        <TouchableOpacity style={styles.secondary} onPress={pickFromLibrary} disabled={busy}>
          <Text style={styles.secondaryText}>ライブラリ</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.shutter} onPress={capture} disabled={busy}>
          <Text style={styles.shutterText}>撮影</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={pickPdf} disabled={busy}>
          <Text style={styles.secondaryText}>PDF</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={[styles.save, busy && { opacity: 0.6 }]} onPress={() => save()} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>保存（{pages.length}ページ）</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  btn: { backgroundColor: "#2563eb", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "bold" },
  modeBar: { flexDirection: "row", justifyContent: "center", gap: 8, paddingVertical: 8, backgroundColor: "#0f172a" },
  modeBtn: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 999, backgroundColor: "#1e293b" },
  modeBtnActive: { backgroundColor: "#2563eb" },
  modeText: { color: "#94a3b8", fontWeight: "600" },
  modeTextActive: { color: "#fff" },
  syncBar: { backgroundColor: "#f59e0b", paddingVertical: 8, alignItems: "center" },
  syncText: { color: "#1f2937", fontWeight: "700" },
  thumbs: { maxHeight: 110, backgroundColor: "#1e293b" },
  thumbWrap: { marginRight: 10, alignItems: "center" },
  thumb: { width: 64, height: 86, borderRadius: 6, backgroundColor: "#334155" },
  thumbIdx: { position: "absolute", top: 2, left: 4, color: "#fff", fontWeight: "700", fontSize: 12, textShadowColor: "#000", textShadowRadius: 3 },
  thumbDel: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" },
  thumbDelText: { color: "#fff", fontWeight: "700" },
  thumbMove: { flexDirection: "row", gap: 14, marginTop: 2 },
  moveText: { color: "#cbd5e1", fontSize: 12 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 12, backgroundColor: "#0f172a" },
  shutter: { backgroundColor: "#2563eb", paddingHorizontal: 36, paddingVertical: 16, borderRadius: 40 },
  shutterText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  secondary: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: "#1e293b" },
  secondaryText: { color: "#e2e8f0", fontWeight: "600" },
  save: { backgroundColor: "#4f46e5", paddingVertical: 16, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
