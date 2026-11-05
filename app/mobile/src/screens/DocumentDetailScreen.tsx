import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "@react-navigation/elements";
import * as Sharing from "expo-sharing";
import {
  downloadAuthed,
  downloadPdf,
  getDocument,
  type DocumentRead,
  type PdfKind,
} from "../api/client";
import { CategoryChip, DeadlineChip, ImportanceBadge } from "../components/FamilyBadges";
import { ActionBar } from "../components/ActionBar";
import { FamilyPanel } from "../components/FamilyPanel";
import { ImageViewer } from "../components/ImageViewer";
import { useDocFamily } from "../components/useDocFamily";
import { colors, radius } from "../theme";

// PDF出力ボタン（Web ビューアと同じ2種・同じ文言）
const PDF_BUTTONS: {
  kind: PdfKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  dialogTitle: string;
  notReadyMsg: string;
}[] = [
  {
    kind: "document",
    label: "電子資料PDF（検索可能）を保存",
    icon: "document-text-outline",
    dialogTitle: "電子資料PDFを保存/送信",
    notReadyMsg: "電子資料PDFはまだ生成されていません（OCR処理の完了後に自動生成されます）。",
  },
  {
    kind: "ocr",
    label: "OCRテキストPDFを保存",
    icon: "reader-outline",
    dialogTitle: "OCRテキストPDFを保存/送信",
    notReadyMsg: "OCRがまだ完了していません。少し待って再度お試しください。",
  },
];

// ドキュメント詳細・画像プレビュー・家族での確認・PDF出力 (F-22, F-14系)
// 開いた時点で詳細を取得し、閲覧ログ記録・既読化を行う（Web ビューアと同じ, F-28/F-32）。
// 通知から開いた場合はタイトルが無いので、取得した詳細のタイトルで見出しを更新する。
// 画像はタップで全画面（ピンチで拡大）。画面下のバーでコメントと「あなたの対応」を送り、一覧へ戻る。
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
  const [viewer, setViewer] = useState(false);
  const family = useDocFamily(id, familyKey);
  const headerHeight = useHeaderHeight();

  // 総ページ数を取得（複数枚は各ページを切り替えて表示できるようにする）
  useEffect(() => {
    getDocument(id)
      .then((d) => {
        setPageCount(Math.max(d.page_count ?? 1, 1));
        setDoc(d);
        setTitle(d.title);
        setFamilyKey((k) => k + 1); // 既読になった状態で家族の確認状況を読み直す
      })
      .catch(() => setPageCount(1));
  }, [id]);

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

  // 対応を押したら、開く前の一覧（書類・検索・お知らせなど）へ戻る
  function backToList() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Main", { screen: "Documents" });
  }

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{title}</Text>
        {doc && (doc.importance === "high" || doc.deadline || doc.category) && (
          <View style={styles.headChips}>
            <CategoryChip
              name={doc.category}
              visibility={doc.category_visibility}
              icon={doc.category_icon}
              color={doc.category_color}
            />
            <ImportanceBadge importance={doc.importance} />
            <DeadlineChip deadline={doc.deadline} />
          </View>
        )}

        <Pressable
          style={styles.imageBox}
          onPress={() => setViewer(true)}
          disabled={!imageUri || loadingImage || !!imageError}
          accessibilityRole="imagebutton"
          accessibilityLabel="画像を全画面で表示"
        >
          {loadingImage ? (
            <ActivityIndicator color={colors.primary} />
          ) : imageError ? (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Ionicons name="image-outline" size={32} color={colors.textSubtle} />
              <Text style={styles.error}>{imageError}</Text>
            </View>
          ) : imageUri ? (
            <>
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
              <View style={styles.expand} pointerEvents="none">
                <Ionicons name="expand-outline" size={16} color="#fff" />
                <Text style={styles.expandText}>タップで拡大</Text>
              </View>
            </>
          ) : null}
        </Pressable>

        {/* 複数ページのページ送り (F-22) */}
        {pageCount > 1 && (
          <View style={styles.pager}>
            <TouchableOpacity
              style={styles.pagerBtn}
              disabled={page <= 0}
              onPress={() => setPage((p) => Math.max(0, p - 1))}
              accessibilityLabel="前のページ"
            >
              <Ionicons name="chevron-back" size={18} color={page <= 0 ? colors.border : colors.text} />
            </TouchableOpacity>
            <Text style={styles.pagerLabel}>{page + 1} / {pageCount}</Text>
            <TouchableOpacity
              style={styles.pagerBtn}
              disabled={page >= pageCount - 1}
              onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              accessibilityLabel="次のページ"
            >
              <Ionicons name="chevron-forward" size={18} color={page >= pageCount - 1 ? colors.border : colors.text} />
            </TouchableOpacity>
          </View>
        )}

        {/* 家族での確認: 解析結果 / 家族の確認状況・再通知 / コメント一覧 */}
        <FamilyPanel docId={id} status={family.status} comments={family.comments} myId={family.myId} />

        <Text style={styles.section}>保存・共有</Text>
        <View style={styles.card}>
          {PDF_BUTTONS.map((b, i) => (
            <TouchableOpacity
              key={b.kind}
              style={[styles.pdfRow, i > 0 && styles.pdfRowBorder]}
              onPress={() => downloadAndShare(b)}
              disabled={busy !== null}
            >
              <View style={styles.pdfIcon}>
                <Ionicons name={b.icon} size={18} color={colors.primary} />
              </View>
              <Text style={styles.pdfLabel}>{b.label}</Text>
              {busy === b.kind ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Ionicons name="share-outline" size={18} color={colors.textSubtle} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* コメントの入力と「あなたの対応」。対応を押すと一覧へ戻る */}
      <ActionBar
        docId={id}
        current={family.mine?.action ?? null}
        onCommentAdded={family.appendComment}
        onDone={backToList}
      />

      <ImageViewer
        visible={viewer}
        uri={imageUri}
        loading={loadingImage}
        page={page}
        pageCount={pageCount}
        onPage={(p) => setPage(Math.max(0, Math.min(pageCount - 1, p)))}
        onClose={() => setViewer(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, lineHeight: 32, marginBottom: 10 },
  headChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginBottom: 8, marginTop: 4 },
  imageBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    marginBottom: 12,
    overflow: "hidden",
  },
  image: { width: "100%", height: 380, borderRadius: radius.sm },
  expand: {
    position: "absolute",
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(15,23,42,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  expandText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  error: { color: colors.textMuted, fontSize: 13 },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  pagerBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  pagerLabel: { color: colors.text, fontWeight: "600", fontSize: 14, minWidth: 56, textAlign: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14 },
  pdfRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  pdfRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pdfIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfLabel: { flex: 1, fontSize: 15, color: colors.text },
});
