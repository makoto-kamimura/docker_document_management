import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isAuthenticated, unreadNotificationCount } from "./api/client";

const POLL_MS = 30000;

// ---- 未読のお知らせ件数: タブのバッジと「お知らせ」画面で共有する（Web と同じ） ----
interface UnreadState {
  unread: number;
  refresh: () => void;
}
const UnreadContext = createContext<UnreadState>({ unread: 0, refresh: () => {} });
export const useUnread = () => useContext(UnreadContext);

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    if (!isAuthenticated()) return;
    unreadNotificationCount().then(setUnread).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return <UnreadContext.Provider value={{ unread, refresh }}>{children}</UnreadContext.Provider>;
}
