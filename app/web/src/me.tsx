import React, { createContext, useContext, useEffect, useState } from "react";
import { isAuthenticated, getMe, type User } from "./api/client";

// ---- 現在ユーザー(me)コンテキスト: ロール別ナビ/ヘッダ表示・操作可否の判定に使う ----
interface MeState {
  me: User | null;
  loading: boolean;
}
const MeContext = createContext<MeState>({ me: null, loading: true });
export const useMe = () => useContext(MeContext);

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isAuthenticated()) {
      setLoading(false);
      return;
    }
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);
  return <MeContext.Provider value={{ me, loading }}>{children}</MeContext.Provider>;
}
