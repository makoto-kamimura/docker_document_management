import { useState } from "react";
import { useLocation } from "react-router-dom";
import { login } from "../api/client";

// ログイン (F-33)
export function LoginPage() {
  const [email, setEmail] = useState("admin@example.com");
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
      const detail = err?.response?.data?.detail;
      setError(detail ?? "ログインに失敗しました。接続先とIDをご確認ください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand-mark">📄</div>
        <h1>ドキュメント管理システム</h1>
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
          開発用初期アカウント<br />
          ID: <code>admin@example.com</code> / PW: <code>admin123</code>
        </div>
      </form>
    </div>
  );
}
