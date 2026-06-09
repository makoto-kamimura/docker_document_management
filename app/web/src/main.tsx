import React, { createContext, useContext, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { DocumentsPage } from "./pages/DocumentsPage";
import { SearchPage } from "./pages/SearchPage";
import { LoginPage } from "./pages/LoginPage";
import { UsersPage } from "./pages/UsersPage";
import { GroupsPage } from "./pages/GroupsPage";
import { isAuthenticated, clearToken, getMe, type User } from "./api/client";
import "./index.css";

// ---- 現在ユーザー(me)コンテキスト: ロール別ナビ/ヘッダ表示に使う ----
interface MeState {
  me: User | null;
  loading: boolean;
}
const MeContext = createContext<MeState>({ me: null, loading: true });
export const useMe = () => useContext(MeContext);

function MeProvider({ children }: { children: React.ReactNode }) {
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { me, loading } = useMe();
  if (loading) {
    return (
      <div className="state">
        <div className="spinner" />
        <p>読み込み中…</p>
      </div>
    );
  }
  if (me?.role !== "admin") {
    return <Navigate to="/documents" replace />;
  }
  return <>{children}</>;
}

const NAV = [
  { to: "/documents", icon: "🗂️", label: "ドキュメント一覧" },
  { to: "/search", icon: "🔍", label: "全文検索" },
  { to: "/users", icon: "👥", label: "ユーザー管理", adminOnly: true },
  { to: "/groups", icon: "🏷️", label: "グループ管理", adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "管理者",
  registrar: "登録者",
  viewer: "閲覧者",
};

function Sidebar() {
  const navigate = useNavigate();
  const { me } = useMe();
  function logout() {
    clearToken();
    navigate("/login", { replace: true });
  }
  const nav = NAV.filter((n) => !n.adminOnly || me?.role === "admin");
  const initial = me?.name?.trim()?.[0] ?? "?";
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">📄</div>
        <div className="brand-text">
          <strong>DMS</strong>
          <span>Document Management</span>
        </div>
      </div>

      <nav className="nav">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-chip">
          <div className="avatar">{initial}</div>
          <div className="meta">
            <strong>{me ? `${me.name}（${ROLE_LABEL[me.role] ?? me.role}）` : "—"}</strong>
            <span>{me?.email ?? ""}</span>
          </div>
        </div>
        <button className="btn-logout" onClick={logout}>
          ログアウト
        </button>
      </div>
    </aside>
  );
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <PageHeader title={title} description={description} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <MeProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Navigate to="/documents" replace />} />
          <Route
            path="/documents"
            element={
              <RequireAuth>
                <Shell title="ドキュメント一覧" description="登録済みの紙資料・電子ドキュメントを管理します">
                  <DocumentsPage />
                </Shell>
              </RequireAuth>
            }
          />
          <Route
            path="/search"
            element={
              <RequireAuth>
                <Shell title="全文検索" description="OCRで抽出したテキストを横断検索します">
                  <SearchPage />
                </Shell>
              </RequireAuth>
            }
          />
          <Route
            path="/users"
            element={
              <RequireAuth>
                <RequireAdmin>
                  <Shell title="ユーザー管理" description="ユーザーの登録・ロール割当・権限を管理します">
                    <UsersPage />
                  </Shell>
                </RequireAdmin>
              </RequireAuth>
            }
          />
          <Route
            path="/groups"
            element={
              <RequireAuth>
                <RequireAdmin>
                  <Shell title="グループ管理" description="グループとメンバーを管理します。同じグループのメンバーはドキュメントを自動で閲覧できます">
                    <GroupsPage />
                  </Shell>
                </RequireAdmin>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </MeProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
