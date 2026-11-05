import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { getMe, isAuthenticated, type User } from "./api/client";

// ログイン中のユーザー。ヘッダーの名前表示とアカウント画面で共有し、名前を変えたらすぐ反映する。
interface MeState {
  me: User | null;
  setMe: (u: User | null) => void;
  refresh: () => Promise<void>;
}

const MeContext = createContext<MeState>({ me: null, setMe: () => {}, refresh: async () => {} });
export const useMe = () => useContext(MeContext);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<User | null>(null);
  const refresh = useCallback(async () => {
    if (!isAuthenticated()) {
      setMe(null);
      return;
    }
    try {
      setMe(await getMe(true));
    } catch {
      // 取れなくても画面は使える（ヘッダーに名前が出ないだけ）
    }
  }, []);
  return <MeContext.Provider value={{ me, setMe, refresh }}>{children}</MeContext.Provider>;
}
