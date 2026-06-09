import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import { searchDocuments, API_V1_BASE, getToken, type SearchHit } from "../api/client";

const MATCH_LABEL: Record<string, string> = {
  ocr_text: "本文",
  summary: "要約",
  title: "タイトル",
};

// 認証付きで /content を取得して表示する検索結果サムネイル
function Thumb({ id }: { id: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    FileSystem.downloadAsync(
      `${API_V1_BASE}/documents/${id}/content`,
      `${FileSystem.cacheDirectory}sthumb_${id}.jpg`,
      { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }
    )
      .then((r) => { if (alive && r.status === 200) setUri(r.uri); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);
  return uri ? (
    <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
  ) : (
    <View style={[styles.thumb, styles.thumbPh]} />
  );
}

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
    <View style={{ flex: 1, padding: 16, backgroundColor: "#f1f5f9" }}>
      <View style={styles.bar}>
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="キーワード（本文・要約・タグ）"
          returnKeyType="search"
          onSubmitEditing={onSearch}
        />
        <TouchableOpacity style={styles.btn} onPress={onSearch}>
          <Text style={styles.btnText}>検索</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#4f46e5" />
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate("Detail", { id: item.id, title: item.title })}
            >
              <Thumb id={item.id} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <Text style={styles.title}>{item.title}</Text>
                  {item.matched_in && (
                    <Text style={styles.match}>{MATCH_LABEL[item.matched_in] ?? item.matched_in}に一致</Text>
                  )}
                </View>
                {item.tags?.length > 0 && (
                  <Text style={styles.tags}>{item.tags.map((t) => `#${t}`).join("  ")}</Text>
                )}
                {item.snippet && (
                  <Text numberOfLines={2} style={styles.snippet}>
                    {stripTags(item.snippet)}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            searched ? (
              <Text style={styles.empty}>一致する結果がありません。</Text>
            ) : (
              <Text style={styles.empty}>
                タイトル・OCR本文・要約・タグを横断して検索します。
              </Text>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  btn: { backgroundColor: "#4f46e5", borderRadius: 10, paddingHorizontal: 18, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", gap: 12, backgroundColor: "#fff", padding: 14, borderRadius: 12, marginBottom: 10, alignItems: "flex-start" },
  thumb: { width: 56, height: 72, borderRadius: 6, backgroundColor: "#e2e8f0" },
  thumbPh: {},
  title: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  match: { backgroundColor: "#ecfdf5", color: "#047857", fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: "hidden" },
  tags: { color: "#64748b", fontSize: 12, marginTop: 4 },
  snippet: { color: "#475569", fontSize: 13, marginTop: 6, lineHeight: 18 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40, paddingHorizontal: 20, lineHeight: 20 },
});
