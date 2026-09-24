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
import * as Sharing from "expo-sharing";
import {
  downloadAuthed,
  downloadPdf,
  getDocument,
  type DocumentRead,
  type PdfKind,
} from "../api/client";
import { DeadlineChip, ImportanceBadge } from "../components/FamilyBadges";
import { FamilyPanel } from "../components/FamilyPanel";

// PDF出力ボタン（Web ビューアと同じ3種・同じ文言）
const PDF_BUTTONS: { kind: PdfKind; label: string; dialogTitle: string; notReadyMsg: string }[] = [
  {
    kind: "document",
    label: "電子資料PDF（検索可能）を保存",
    dialogTitle: "電子資料PDFを保存/送信",
    notReadyMsg: "電子資料PDFはまだ生成されていません（OCR処理の完了後に自動生成されます）。",
  },
  {
    kind: "ocr",
    label: "OCRテキストPDFを保存",
    dialogTitle: "OCRテキストPDFを保存/送信",
    notReadyMsg: "OCRがまだ完了していません。少し待って再度お試しください。",
  },
  {
    kind: "summary",
    label: "要約PDFを出力",
    dialogTitle: "要約PDFを保存/送信",
    notReadyMsg: "OCRがまだ完了していません。少し待って再度お試しください。",
  },
];

// ドキュメント詳細・画像プレビュー・家族での確認・PDF出力 (F-22, F-14系)
// 開いた時点で詳細を取得し、閲覧ログ記録・既読化を行う（Web ビューアと同じ, F-28/F-32）。
// 通知から開いた場合はタイトルが無いので、取得した詳細のタイトルで見出しを更新する。
export function DocumentDetailScreen({ route, navigation }: any) {
  const { id, title: initialTitle } = route.params as { id: string; title?: string };
  const [title, setTitle] = useState(initialTitle ?? "");
  const [familyKey, setFamilyKey] = useState(0);
  const [doc, setDoc] = useState<DocumentRead | null>(null);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(true);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PdfKind | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(0);

  // 総ページ数を取得（複数枚は各ページを切り替えて表示できるようにする）
  useEffect(() => {
    getDocument(id)
      .then((d) => {
        setPageCount(Math.max(d.page_count ?? 1, 1));
        setDoc(d);
        setTitle(d.title);
        navigation.setOptions({ title: d.title });
        setFamilyKey((k) => k + 1); // 既読になった状態で家族の確認状況を読み直す
      })
      .catch(() => setPageCount(1));
  }, [id, navigation]);

  // 指定ページの処理済み画像を取得（ページごとにキャッシュ名を分けて取り違えを防ぐ）
  const loadImage = useCallback(async (p: number) => {
    setLoadingImage(true);
    setImageError(null);
    try {
      const res = await downloadAuthed(`/documents/${id}/pages/${p}/content`, `doc_${id}_p${p}.jpg`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      setImageUri(res.uri);
    } catch {
      setImageError("画像を取得できませんでした。");
    } finally {
      setLoadingImage(false);
    }
  }, [id]);

  useEffect(() => {
    loadImage(page);
  }, [loadImage, page]);

  async function downloadAndShare(b: (typeof PDF_BUTTONS)[number]) {
    setBusy(b.kind);
    try {
      const res = await downloadPdf(id, b.kind);
      if (res.status === 404 || res.status === 409) {
        Alert.alert("まだ出力できません", b.notReadyMsg);
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
        dialogTitle: b.dialogTitle,
      });
    } catch {
      Alert.alert("エラー", "PDFの出力に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>{title}</Text>
      {doc && (doc.importance === "high" || doc.deadline) && (
        <View style={styles.headChips}>
          <ImportanceBadge importance={doc.importance} />
          <DeadlineChip deadline={doc.deadline} />
        </View>
      )}

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

      {/* 家族での確認: 解析結果 / 自分の対応 / 家族の確認状況・再通知 / コメント */}
      <FamilyPanel docId={id} reloadKey={familyKey} />

      <Text style={styles.section}>保存・共有</Text>
      {/* 先頭（電子資料PDF）を主ボタン、残りを副ボタンで表示 */}
      {PDF_BUTTONS.map((b, i) => {
        const primary = i === 0;
        return (
          <TouchableOpacity
            key={b.kind}
            style={[styles.pdfBtn, !primary && styles.pdfBtnSecondary]}
            onPress={() => downloadAndShare(b)}
            disabled={busy !== null}
          >
            {busy === b.kind ? (
              <ActivityIndicator color={primary ? "#fff" : "#4f46e5"} />
            ) : (
              <Text style={[styles.pdfBtnText, !primary && styles.pdfBtnTextSecondary]}>{b.label}</Text>
            )}
          </TouchableOpacity>
        );
      })}

      <Text style={styles.hint}>
        複数ページはページ送りで全ページ表示できます。検索可能な電子資料PDF、OCRで認識した文字を集約したテキストPDF、要約PDFを保存/共有できます。
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },
  title: { fontSize: 18, fontWeight: "700", color: "#0f172a", marginBottom: 8 },
  headChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  section: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 6 },
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
});
