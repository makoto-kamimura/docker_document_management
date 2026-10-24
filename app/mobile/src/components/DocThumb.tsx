import { useEffect, useState } from "react";
import { Image, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { downloadAuthed } from "../api/client";
import { colors } from "../theme";

// 一覧グリッド/検索結果のサムネイル（認証付きで /content を取得して表示）
export function DocThumb({ id, style }: { id: string; style: StyleProp<ImageStyle> }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    downloadAuthed(`/documents/${id}/content`, `thumb_${id}.jpg`)
      .then((r) => { if (alive && r.status === 200) setUri(r.uri); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);
  if (uri) return <Image source={{ uri }} style={style} resizeMode="cover" />;
  // 読み込み前・取得できないときは書類アイコンを出す
  return (
    <View style={[style as StyleProp<ViewStyle>, { alignItems: "center", justifyContent: "center" }]}>
      <Ionicons name="document-outline" size={22} color={colors.textSubtle} />
    </View>
  );
}
