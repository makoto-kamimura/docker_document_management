import { useCallback, useEffect, useState } from "react";
import { getFamilyStatus, getMe, listComments, type Comment, type FamilyStatus } from "../api/client";

// 書類詳細の「家族の確認状況」とコメント。FamilyPanel（表示）と ActionBar（送信）で共有する。
export function useDocFamily(docId: string, reloadKey: number) {
  const [status, setStatus] = useState<FamilyStatus | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [myId, setMyId] = useState<string | null>(null);

  const load = useCallback(() => {
    getFamilyStatus(docId).then(setStatus).catch(() => {});
    listComments(docId).then(setComments).catch(() => {});
  }, [docId]);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { getMe().then((u) => setMyId(u.id)).catch(() => {}); }, []);

  const appendComment = useCallback((c: Comment) => setComments((prev) => [...prev, c]), []);
  const mine = status?.members.find((m) => m.user_id === myId) ?? null;

  return { status, comments, myId, mine, appendComment };
}
