import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isAuthenticated, getMe, type User } from "./api/client";

// ---- 現在ユーザー(me)コンテキスト: ロール別ナビ/ヘッダ表示・操作可否の判定に使う ----
interface MeState {
  me: User | null;
  loading: boolean;
  setMe: (u: User) => void;       // 名前を変えたときなど、手元の情報を差し替える
  refresh: () => Promise<void>;   // サーバーから取り直す
}
const MeContext = createContext<MeState>({
  me: null,
  loading: true,
  setMe: () => {},
  refresh: async () => {},
});
export const useMe = () => useContext(MeContext);

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!isAuthenticated()) {
      setMe(null);
      return;
    }
    try {
      setMe(await getMe());
    } catch {
      setMe(null);
    }
  }, []);
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);
  return <MeContext.Provider value={{ me, loading, setMe, refresh }}>{children}</MeContext.Provider>;
}
