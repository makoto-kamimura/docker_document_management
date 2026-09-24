import { useState } from "react";
import { useLocation } from "react-router-dom";
import { login, apiErrorMessage, DEMO_ACCOUNTS } from "../api/client";

// ログイン (F-33)
export function LoginPage() {
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const location = useLocation();
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
        <div className="brand-mark">📄</div>
        <h1>紙ログ</h1>
        <p className="subtitle">サインインして続行</p>

        {error && <div className="login-error">{error}</div>}

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

        <div className="login-hint">
          お試し用デモアカウント（ロールごとの見え方を試せます）
          <div className="demo-accounts">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                className={"demo-account" + (email === a.email ? " active" : "")}
                onClick={() => {
                  setEmail(a.email);
                  setPassword(a.password);
                }}
              >
                <strong>{a.label}</strong>
                <span>{a.description}</span>
              </button>
            ))}
          </div>
          パスワードはいずれも <code>{DEMO_ACCOUNTS[0].password}</code>
          <br />
          <span className="login-hint-note">
            デモは専用テナントのため、実利用の書類とは完全に分離されています。<br />
            実際の書類はご自分のアカウント（実利用テナント）でご利用ください
          </span>
        </div>
      </form>
    </div>
  );
}
