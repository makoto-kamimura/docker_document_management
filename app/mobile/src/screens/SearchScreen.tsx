import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { listDocuments, searchDocuments, type DocumentRead, type SearchHit } from "../api/client";
import { CategoryIcon } from "../categoryStyle";
import { DocThumb } from "../components/DocThumb";
import { buildLocalIndex, filterLocally, LOCAL_FIELD_LABEL, type LocalHit } from "../localSearch";
import { colors, radius } from "../theme";

const MATCH_LABEL: Record<string, string> = {
  ocr_text: "本文",
  title: "タイトル",
};

// HTML の <em> ハイライトタグを除去して素のスニペットにする
function stripTags(s: string | null): string {
  return (s ?? "").replace(/<\/?em>/g, "");
}

// 検索 (F-23〜F-26)。サーバーの負荷を抑えるため2段にする（Web と同じ）:
// - 入力中: 画面を開いたときに取った一覧を、端末内でタイトル・タグ・カテゴリ・書類の種類から絞り込む（通信なし）
// - 確定（キーボードの「検索」/「本文からも探す」）: 全文検索を1回。OCR 本文・ひらがなの読み・OCR の読み違いでも当たる
// 入力中の候補は、サムネイルの代わりにカテゴリのアイコンを出す（サムネイルは1件ごとに画像を取りに行くため）
export function SearchScreen() {
  const navigation = useNavigation<any>();
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<DocumentRead[]>([]);
  // 確定した全文検索の結果。入力欄を打ち直すと（検索語が変わると）入力中の絞り込みに戻る
  const [full, setFull] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  // 最後に送った全文検索の番号（遅れて届いた古い結果で上書きしない）
  const latest = useRef(0);

  // 書類の追加・削除を反映するため、画面に来るたびに一覧を1回だけ取り直す
  useFocusEffect(
    useCallback(() => {
      listDocuments().then(setDocs).catch(() => {});
    }, [])
  );

  const index = useMemo(() => buildLocalIndex(docs), [docs]);
  const query = q.trim();
  // 表示中の全文検索の結果（入力欄の語と同じときだけ）
  const shown = full && full.query === query ? full : null;
  const local = useMemo(
    () => (query && !shown ? filterLocally(index, query) : []),
    [index, query, shown]
  );

  async function onSearch() {
    if (!query) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const hits = await searchDocuments(query);
      if (id === latest.current) setFull({ query, hits });
    } catch {
      if (id === latest.current) setFull({ query, hits: [] });
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }

  const openDoc = (d: { id: string; title: string }) => navigation.navigate("Detail", { id: d.id, title: d.title });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={colors.textSubtle} />
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="本文・タイトル・タグから探す"
          placeholderTextColor={colors.textSubtle}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          onSubmitEditing={onSearch}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : shown ? (
        <FlatList
          data={shown.hits}
          keyExtractor={(h) => h.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            shown.hits.length > 0 ? <Text style={styles.listHead}>本文も含めた検索結果（{shown.hits.length}件）</Text> : undefined
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openDoc(item)}>
              <DocThumb id={item.id} style={styles.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {item.matched_in && (
                  <Text style={styles.match}>{MATCH_LABEL[item.matched_in] ?? item.matched_in}に一致</Text>
                )}
                {item.snippet && (
                  <Text numberOfLines={2} style={styles.snippet}>
                    {stripTags(item.snippet)}
                  </Text>
                )}
                <Tags tags={item.tags} />
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Empty icon="document-outline" text="一致する結果がありません。" />}
        />
      ) : (
        <FlatList
          data={local}
          keyExtractor={(h) => h.doc.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            query ? (
              <TouchableOpacity style={styles.fullBtn} onPress={onSearch} accessibilityRole="button">
                <Ionicons name="document-text-outline" size={18} color={colors.primary} />
                <Text style={styles.fullBtnText} numberOfLines={1}>「{query}」を本文からも探す</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            ) : undefined
          }
          renderItem={({ item }) => <LocalRow hit={item} onPress={() => openDoc(item.doc)} />}
          ListEmptyComponent={
            query ? (
              <Empty
                icon="document-outline"
                text={"タイトル・タグ・カテゴリには見つかりません。\n上のボタンかキーボードの「検索」で、本文や読みからも探せます。"}
              />
            ) : (
              <Empty
                icon="search-outline"
                text={"入力するとタイトル・タグ・カテゴリから絞り込みます。\nキーボードの「検索」で、本文やひらがな（読み）からも探せます。"}
              />
            )
          }
        />
      )}
    </View>
  );
}

// 入力中の候補（端末内の絞り込み）
function LocalRow({ hit, onPress }: { hit: LocalHit; onPress: () => void }) {
  const { doc, matchedIn } = hit;
  const meta = [doc.category ?? "未分類", doc.document_type].filter(Boolean).join(" · ");
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <CategoryIcon icon={doc.category_icon} color={doc.category_color} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={2}>{doc.title}</Text>
        <Text style={styles.match}>{LOCAL_FIELD_LABEL[matchedIn]}に一致</Text>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        <Tags tags={doc.tags} />
      </View>
    </TouchableOpacity>
  );
}

function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return <Text style={styles.tags}>{tags.map((t) => `#${t}`).join("  ")}</Text>;
}

function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.textSubtle} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 16, color: colors.text },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  listHead: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginBottom: 8 },
  fullBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  fullBtnText: { flex: 1, color: colors.primary, fontWeight: "700", fontSize: 14 },
  row: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: radius.lg,
    marginBottom: 8,
    alignItems: "flex-start",
  },
  thumb: { width: 52, height: 68, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  match: { color: colors.success, fontSize: 11, fontWeight: "700", marginTop: 3 },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  snippet: { color: colors.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  tags: { color: colors.primary, fontSize: 12, marginTop: 6 },
  empty: { alignItems: "center", marginTop: 80, gap: 10, paddingHorizontal: 32 },
  emptyText: { textAlign: "center", color: colors.textSubtle, fontSize: 14, lineHeight: 20 },
});
