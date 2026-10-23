import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { searchDocuments, type SearchHit } from "../api/client";
import { DocThumb } from "../components/DocThumb";
import { colors, radius } from "../theme";

const MATCH_LABEL: Record<string, string> = {
  ocr_text: "本文",
  summary: "要約",
  title: "タイトル",
};

// HTML の <em> ハイライトタグを除去して素のスニペットにする
function stripTags(s: string | null): string {
  return (s ?? "").replace(/<\/?em>/g, "");
}

// 全文検索 (F-23〜F-26)。タイトル・OCR本文・要約・タグを横断する。
export function SearchScreen() {
  const navigation = useNavigation<any>();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function onSearch() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setHits(await searchDocuments(q.trim()));
      setSearched(true);
    } catch {
      setHits([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={colors.textSubtle} />
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="本文・要約・タグから探す"
          placeholderTextColor={colors.textSubtle}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          onSubmitEditing={onSearch}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate("Detail", { id: item.id, title: item.title })}
            >
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
                {item.tags?.length > 0 && (
                  <Text style={styles.tags}>{item.tags.map((t) => `#${t}`).join("  ")}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name={searched ? "document-outline" : "search-outline"} size={40} color={colors.textSubtle} />
              <Text style={styles.emptyText}>
                {searched ? "一致する結果がありません。" : "タイトル・OCR本文・要約・タグを横断して検索します。"}
              </Text>
            </View>
          }
        />
      )}
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
  snippet: { color: colors.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  tags: { color: colors.primary, fontSize: 12, marginTop: 6 },
  empty: { alignItems: "center", marginTop: 80, gap: 10, paddingHorizontal: 32 },
  emptyText: { textAlign: "center", color: colors.textSubtle, fontSize: 14, lineHeight: 20 },
});
