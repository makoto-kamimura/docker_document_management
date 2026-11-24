import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { IoAlertCircleOutline } from "react-icons/io5";
import { login, apiErrorMessage } from "../api/client";
import { fetchSsoName, SSO_COPY, ssoErrorMessage, startSso } from "../api/sso";

// ログイン (F-33)
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sso, setSso] = useState<string | null>(null);
  const location = useLocation();
  const ssoError = new URLSearchParams(location.search).get("sso_error");

  useEffect(() => {
    void fetchSsoName().then(setSso);
  }, []);

  async function onSso() {
    setError(null);
    setLoading(true);
    try {
      await startSso("login");
    } catch {
      setError(ssoErrorMessage("failed", "login", sso ?? "SSO"));
      setLoading(false);
    }
  }
  const from = (location.state as { from?: string } | null)?.from ?? "/documents";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      // 現在ユーザー(me)をロードし直すため、SPA遷移ではなくフルリロードで遷移する
      window.location.assign(from);
    } catch (err: any) {
      setError(apiErrorMessage(err, "ログインに失敗しました。接続先とIDをご確認ください。"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <img className="brand-mark" src="/favicon.svg" alt="" />
        <h1>紙ログ</h1>
        <p className="subtitle">サインインして続行</p>

        {(error || ssoError) && (
          <div className="login-error">
            <IoAlertCircleOutline />
            {error ?? ssoErrorMessage(ssoError, "login", sso ?? "SSO")}
          </div>
        )}

        <div className="field">
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="field">
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
          {loading ? "サインイン中…" : "サインイン"}
        </button>

        {sso && (
          <>
            <p style={{ textAlign: "center", color: "var(--text-subtle)", fontSize: 13, margin: "16px 0 8px" }}>
              {SSO_COPY.or}
            </p>
            <button type="button" className="btn" style={{ width: "100%" }} disabled={loading} onClick={onSso}>
              {SSO_COPY.login(sso)}
            </button>
            <p style={{ color: "var(--text-subtle)", fontSize: 12, margin: "8px 0 0" }}>{SSO_COPY.loginHint(sso)}</p>
          </>
        )}
      </form>
    </div>
  );
}
