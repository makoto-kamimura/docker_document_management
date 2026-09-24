import { useEffect, useState } from "react";
import { Image, View, type ImageStyle, type StyleProp } from "react-native";
import { downloadAuthed } from "../api/client";

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
  return uri ? <Image source={{ uri }} style={style} resizeMode="cover" /> : <View style={style} />;
}
