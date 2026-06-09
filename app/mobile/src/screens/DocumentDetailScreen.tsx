import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_V1_BASE, getToken, api } from "../api/client";

interface ReadReceipt {
  user_id: string;
  user_name: string;
  user_email: string;
  read_at: string;
}

// ドキュメント詳細・画像プレビュー・要約PDF出力 (F-22, F-14系)
export function DocumentDetailScreen({ route }: any) {
  const { id, title } = route.params as { id: string; title: string };
  const authHeader = { Authorization: `Bearer ${getToken() ?? ""}` };

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(true);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "summary" | "document" | "ocr">(null);
  const [reads, setReads] = useState<ReadReceipt[] | null>(null); // 所有者/管理者のみ取得成功
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(0);

  // 総ページ数を取得（複数枚は各ページを切り替えて表示できるようにする）
  useEffect(() => {
    api
      .get(`/documents/${id}`)
      .then((r) => setPageCount(Math.max((r.data as any).page_count ?? 1, 1)))
      .catch(() => setPageCount(1));
  }, [id]);

  // 指定ページの処理済み画像を取得（ページごとにキャッシュ名を分けて取り違えを防ぐ）
  const loadImage = useCallback(async (p: number) => {
    setLoadingImage(true);
    setImageError(null);
    try {
      const target = `${FileSystem.cacheDirectory}doc_${id}_p${p}.jpg`;
      const res = await FileSystem.downloadAsync(
        `${API_V1_BASE}/documents/${id}/pages/${p}/content`,
        target,
        { headers: authHeader }
      );
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      setImageUri(res.uri);
    } catch (e: any) {
      setImageError("画像を取得できませんでした。");
    } finally {
      setLoadingImage(false);
    }
  }, [id]);

  useEffect(() => {
    loadImage(page);
  }, [loadImage, page]);

  // 既読者一覧（所有者/管理者のみ 200。それ以外は 403 で取得せず非表示）
  useEffect(() => {
    api
      .get<ReadReceipt[]>(`/documents/${id}/reads`)
      .then((r) => setReads(r.data))
      .catch(() => setReads(null));
  }, [id]);

  async function downloadAndShare(opts: {
    kind: "summary" | "document" | "ocr";
    path: string;
    fileName: string;
    dialogTitle: string;
    notReadyMsg: string;
  }) {
    setBusy(opts.kind);
    try {
      const target = `${FileSystem.cacheDirectory}${opts.fileName}`;
      const res = await FileSystem.downloadAsync(`${API_V1_BASE}${opts.path}`, target, {
        headers: authHeader,
      });
      if (res.status === 404 || res.status === 409) {
        Alert.alert("まだ出力できません", opts.notReadyMsg);
        return;
      }
      if (res.status !== 200) throw new Error(`status ${res.status}`);

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("共有不可", "この端末では共有機能を利用できません。");
        return;
      }
      await Sharing.shareAsync(res.uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: opts.dialogTitle,
      });
    } catch (e: any) {
      Alert.alert("エラー", "PDFの出力に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  const exportSummaryPdf = () =>
    downloadAndShare({
      kind: "summary",
      path: `/documents/${id}/pdf`,
      fileName: `summary_${id}.pdf`,
      dialogTitle: "要約PDFを保存/送信",
      notReadyMsg: "OCRがまだ完了していません。少し待って再度お試しください。",
    });

  const saveDocumentPdf = () =>
    downloadAndShare({
      kind: "document",
      path: `/documents/${id}/document-pdf`,
      fileName: `document_${id}.pdf`,
      dialogTitle: "電子資料PDFを保存/送信",
      notReadyMsg: "電子資料PDFはまだ生成されていません（OCR処理の完了後に自動生成されます）。",
    });

  // OCRで認識した文字を集約したPDF（全文）を保存/共有
  const exportOcrTextPdf = () =>
    downloadAndShare({
      kind: "ocr",
      path: `/documents/${id}/ocr-pdf`,
      fileName: `ocr_text_${id}.pdf`,
      dialogTitle: "OCRテキストPDFを保存/送信",
      notReadyMsg: "OCRがまだ完了していません。少し待って再度お試しください。",
    });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.imageBox}>
        {loadingImage ? (
          <ActivityIndicator />
        ) : imageError ? (
          <Text style={styles.error}>{imageError}</Text>
        ) : imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
        ) : null}
      </View>

      {/* 複数ページのページ送り (F-22) */}
      {pageCount > 1 && (
        <View style={styles.pager}>
          <TouchableOpacity
            style={[styles.pagerBtn, page <= 0 && styles.pagerBtnDisabled]}
            disabled={page <= 0}
            onPress={() => setPage((p) => Math.max(0, p - 1))}
          >
            <Text style={styles.pagerBtnText}>‹ 前へ</Text>
          </TouchableOpacity>
          <Text style={styles.pagerLabel}>{page + 1} / {pageCount}</Text>
          <TouchableOpacity
            style={[styles.pagerBtn, page >= pageCount - 1 && styles.pagerBtnDisabled]}
            disabled={page >= pageCount - 1}
            onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            <Text style={styles.pagerBtnText}>次へ ›</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={styles.pdfBtn}
        onPress={saveDocumentPdf}
        disabled={busy !== null}
      >
        {busy === "document" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.pdfBtnText}>電子資料PDF（検索可能）を保存</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.pdfBtn, styles.pdfBtnSecondary]}
        onPress={exportOcrTextPdf}
        disabled={busy !== null}
      >
        {busy === "ocr" ? (
          <ActivityIndicator color="#4f46e5" />
        ) : (
          <Text style={[styles.pdfBtnText, styles.pdfBtnTextSecondary]}>OCRテキストPDFを保存</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.pdfBtn, styles.pdfBtnSecondary]}
        onPress={exportSummaryPdf}
        disabled={busy !== null}
      >
        {busy === "summary" ? (
          <ActivityIndicator color="#4f46e5" />
        ) : (
          <Text style={[styles.pdfBtnText, styles.pdfBtnTextSecondary]}>要約PDFを出力</Text>
        )}
      </TouchableOpacity>

      {reads && (
        <View style={styles.readsBox}>
          <Text style={styles.readsTitle}>既読者（{reads.length}）</Text>
          {reads.length === 0 ? (
            <Text style={styles.readsEmpty}>まだ誰も閲覧していません。</Text>
          ) : (
            reads.map((r) => (
              <View key={r.user_id} style={styles.readRow}>
                <Text style={styles.readName}>{r.user_name}</Text>
                <Text style={styles.readAt}>
                  {new Date(r.read_at).toLocaleString("ja-JP")}
                </Text>
              </View>
            ))
          )}
        </View>
      )}

      <Text style={styles.hint}>
        複数ページはページ送りで全ページ表示できます。検索可能な電子資料PDF、OCRで認識した文字を集約したテキストPDF、要約PDFを保存/共有できます。
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },
  title: { fontSize: 18, fontWeight: "700", color: "#0f172a", marginBottom: 14 },
  imageBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    marginBottom: 18,
  },
  image: { width: "100%", height: 360, borderRadius: 8 },
  error: { color: "#e11d48", fontSize: 13 },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginBottom: 16,
  },
  pagerBtn: { backgroundColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  pagerBtnDisabled: { opacity: 0.4 },
  pagerBtnText: { color: "#334155", fontWeight: "700" },
  pagerLabel: { color: "#0f172a", fontWeight: "600", minWidth: 56, textAlign: "center" },
  pdfBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 10,
  },
  pdfBtnSecondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#4f46e5",
  },
  pdfBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  pdfBtnTextSecondary: { color: "#4f46e5" },
  hint: { textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 14 },
  readsBox: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginTop: 18 },
  readsTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a", marginBottom: 8 },
  readsEmpty: { color: "#94a3b8", fontSize: 13 },
  readRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  readName: { color: "#0f172a", fontSize: 14 },
  readAt: { color: "#64748b", fontSize: 12 },
});
