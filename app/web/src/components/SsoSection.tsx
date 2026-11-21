import { useEffect, useState } from "react";
import { apiErrorMessage } from "../api/client";
import {
  fetchSsoIdentities,
  setSsoOnly,
  SSO_COPY,
  ssoErrorMessage,
  startSso,
  unlinkSso,
  type SsoIdentities,
} from "../api/sso";

// アカウントの画面の SSO の欄: 連携・解除と「SSO だけでログインする」
export function SsoSection({ notice }: { notice: { linked: boolean; error: string | null } }) {
  const [ids, setIds] = useState<SsoIdentities | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice.linked ? SSO_COPY.linked : null);

  const load = () =>
    fetchSsoIdentities()
      .then(setIds)
      .catch(() => setIds(null));
  useEffect(() => {
    void load();
  }, []);

  const name = ids?.sso_name || "SSO";
  const shownError = error ?? ssoErrorMessage(notice.error, "link", name);
  if (!ids?.sso_enabled) return null;
  const sso = ids.identities.find((i) => i.provider === "sso");

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (done) setInfo(done);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "操作できませんでした。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field" style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 14 }}>
      <label>{SSO_COPY.linkTitle(name)}</label>
      <p style={{ color: "var(--text-subtle)", fontSize: 12, margin: "0 0 10px" }}>{SSO_COPY.linkDescription(name)}</p>
      {shownError && <div className="login-error">{shownError}</div>}
      {info && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{info}</p>}
      {sso ? (
        <>
          <p style={{ fontSize: 13, margin: "0 0 8px" }}>{SSO_COPY.linkedAs(sso.email ?? name)}</p>
          <p style={{ fontSize: 13, margin: "0 0 4px" }}>{SSO_COPY.ssoOnlyTitle(name, ids.sso_only)}</p>
          <p style={{ color: "var(--text-subtle)", fontSize: 12, margin: "0 0 8px" }}>{SSO_COPY.ssoOnlyDescription}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ids.sso_only ? (
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => setSsoOnly(false))}>
                {SSO_COPY.ssoOnlyOff}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={busy || ids.login_method !== "sso"}
                onClick={() => window.confirm(SSO_COPY.ssoOnlyConfirm(name)) && run(() => setSsoOnly(true))}
              >
                {SSO_COPY.ssoOnlyOn}
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => window.confirm(SSO_COPY.unlinkConfirm(name)) && run(unlinkSso)}
            >
              {SSO_COPY.unlink}
            </button>
          </div>
          {!ids.sso_only && ids.login_method !== "sso" && (
            <p style={{ color: "var(--text-subtle)", fontSize: 12, margin: "8px 0 0" }}>{SSO_COPY.ssoOnlyNeedsSso(name)}</p>
          )}
        </>
      ) : ids.can_link ? (
        <button type="button" className="btn" disabled={busy} onClick={() => run(() => startSso("link"))}>
          {SSO_COPY.link(name)}
        </button>
      ) : (
        <p style={{ color: "var(--text-subtle)", fontSize: 13, margin: 0 }}>{SSO_COPY.demoDenied(name)}</p>
      )}
    </div>
  );
}
