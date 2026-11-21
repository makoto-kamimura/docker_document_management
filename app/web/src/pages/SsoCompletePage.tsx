import { useEffect } from "react";
import { completeSso, SSO_COPY } from "../api/sso";

// 認証サーバーから API を経由して戻ってくる。結果コードと sessionStorage の code_verifier を交換する
export function SsoCompletePage() {
  useEffect(() => {
    void completeSso(new URLSearchParams(window.location.search)).then((to) => window.location.replace(to));
  }, []);
  return (
    <div className="state">
      <div className="spinner" />
      <p>{SSO_COPY.signingIn}</p>
    </div>
  );
}
