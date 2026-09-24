import React, { useEffect, useState } from "react";
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
import { TenantsPage } from "./pages/TenantsPage";
import { SearchPage } from "./pages/SearchPage";
import { LoginPage } from "./pages/LoginPage";
import { UsersPage } from "./pages/UsersPage";
import { GroupsPage } from "./pages/GroupsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import {
  isAuthenticated,
  clearToken,
  isAdminRole,
  listTenants,
  getActiveTenant,
  setActiveTenant,
  ISSUE_URL,
  ROLE_LABEL,
  type Tenant,
} from "./api/client";
import { MeProvider, useMe } from "./me";
import { UnreadProvider, useUnread } from "./unread";
import "./index.css";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function Loading() {
  return (
    <div className="state">
      <div className="spinner" />
      <p>読み込み中…</p>
    </div>
  );
}

// テナント管理者 or 全体管理者
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { me, loading } = useMe();
  if (loading) return <Loading />;
  if (!isAdminRole(me?.role)) {
    return <Navigate to="/documents" replace />;
  }
  return <>{children}</>;
}

// テナントそのものの管理は全体管理者のみ
function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { me, loading } = useMe();
  if (loading) return <Loading />;
  if (me?.role !== "super_admin") {
    return <Navigate to="/documents" replace />;
  }
  return <>{children}</>;
}

interface NavItem {
  to: string;
  icon: string;
  label: string;
  badge?: boolean;
  adminOnly?: boolean;   // テナント管理者 or 全体管理者
  superOnly?: boolean;   // 全体管理者のみ
}

const NAV: NavItem[] = [
  { to: "/documents", icon: "🗂️", label: "ドキュメント一覧" },
  { to: "/notifications", icon: "🔔", label: "お知らせ", badge: true },
  { to: "/search", icon: "🔍", label: "全文検索" },
  { to: "/users", icon: "👥", label: "ユーザー管理", adminOnly: true },
  { to: "/groups", icon: "🏷️", label: "グループ管理", adminOnly: true },
  { to: "/tenants", icon: "🏛️", label: "テナント管理", superOnly: true },
];

/** 全体管理者が操作対象のテナントを切り替えるセレクタ。切替後はデータを取り直すため再読込する。 */
function TenantSwitcher() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const active = getActiveTenant() ?? "";
  useEffect(() => {
    listTenants().then(setTenants).catch(() => setTenants([]));
  }, []);
  return (
    <div className="tenant-switcher">
      <label htmlFor="tenant-switch">操作対象テナント</label>
      <select
        id="tenant-switch"
        className="select"
        value={active}
        onChange={(e) => {
          setActiveTenant(e.target.value || null);
          window.location.reload();
        }}
      >
        <option value="">すべてのテナント</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.is_demo ? "（デモ）" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function Sidebar() {
  const navigate = useNavigate();
  const { me } = useMe();
  const { unread } = useUnread();
  function logout() {
    clearToken();
    navigate("/login", { replace: true });
  }
  const nav = NAV.filter(
    (n) => (!n.adminOnly || isAdminRole(me?.role)) && (!n.superOnly || me?.role === "super_admin")
  );
  const initial = me?.name?.trim()?.[0] ?? "?";
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">📄</div>
        <div className="brand-text">
          <strong>紙ログ</strong>
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
            {n.badge && unread > 0 && <span className="nav-badge">{unread > 99 ? "99+" : unread}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {me?.role === "super_admin" && <TenantSwitcher />}
        <a
          href={ISSUE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="nav-item"
        >
          <span className="icon">🐛</span>
          バグ報告
        </a>
        <div className="user-chip">
          <div className="avatar">{initial}</div>
          <div className="meta">
            <strong>{me ? `${me.name}（${ROLE_LABEL[me.role] ?? me.role}）` : "—"}</strong>
            <span>{me?.tenant_name ? `${me.tenant_name} / ${me.email}` : me?.email ?? ""}</span>
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

function NotificationsRoute() {
  const { refresh } = useUnread();
  return <NotificationsPage onRead={refresh} />;
}

function App() {
  return (
    <BrowserRouter>
      <MeProvider>
        <UnreadProvider>
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
            <Route
              path="/notifications"
              element={
                <RequireAuth>
                  <Shell title="お知らせ" description="家族が撮影した紙・確認のお願い・期限・コメントのお知らせです">
                    <NotificationsRoute />
                  </Shell>
                </RequireAuth>
              }
            />
            <Route
              path="/tenants"
              element={
                <RequireAuth>
                  <RequireSuperAdmin>
                    <Shell title="テナント管理" description="利用者ごとのデータ分離の単位です。デモと実利用を分けて、テナントをまたいだ閲覧を防ぎます">
                      <TenantsPage />
                    </Shell>
                  </RequireSuperAdmin>
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/documents" replace />} />
          </Routes>
        </UnreadProvider>
      </MeProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
