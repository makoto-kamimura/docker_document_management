import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
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
import { StoragePage } from "./pages/StoragePage";
import { CategoriesPage } from "./pages/CategoriesPage";
import {
  isAuthenticated,
  clearToken,
  isAdminRole,
  ISSUE_URL,
  ROLE_LABEL,
  apiErrorMessage,
  updateMe,
} from "./api/client";
import type { IconType } from "react-icons";
import {
  IoBugOutline,
  IoBusinessOutline,
  IoDocumentText,
  IoDocumentTextOutline,
  IoFolderOutline,
  IoLogOutOutline,
  IoNotificationsOutline,
  IoPeopleOutline,
  IoPricetagsOutline,
  IoSearchOutline,
  IoServerOutline,
} from "react-icons/io5";
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
  icon: IconType;
  label: string;
  badge?: boolean;
  adminOnly?: boolean;   // テナント管理者 or 全体管理者
  superOnly?: boolean;   // 全体管理者のみ
}

const NAV: NavItem[] = [
  { to: "/documents", icon: IoDocumentTextOutline, label: "ドキュメント一覧" },
  { to: "/notifications", icon: IoNotificationsOutline, label: "お知らせ", badge: true },
  { to: "/search", icon: IoSearchOutline, label: "全文検索" },
  { to: "/users", icon: IoPeopleOutline, label: "ユーザー管理", adminOnly: true },
  { to: "/groups", icon: IoPricetagsOutline, label: "グループ管理", adminOnly: true },
  { to: "/categories", icon: IoFolderOutline, label: "カテゴリ管理", adminOnly: true },
  { to: "/storage", icon: IoServerOutline, label: "保存先", adminOnly: true },
  { to: "/tenants", icon: IoBusinessOutline, label: "テナント管理", superOnly: true },
];

// 自分の表示名の変更（家族の確認状況・コメントに出る名前）
function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me, setMe } = useMe();
  const [name, setName] = useState(me?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next) return setError("名前を入力してください。");
    setSaving(true);
    setError(null);
    try {
      setMe(await updateMe({ name: next }));
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "名前を変更できませんでした。"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>アカウント</h2>
        <div className="field">
          <label htmlFor="profile-name">表示名</label>
          <input
            id="profile-name"
            className="input"
            value={name}
            maxLength={100}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <p style={{ color: "var(--text-subtle)", fontSize: 12, margin: "6px 0 0" }}>
            家族の確認状況やコメントに表示される名前です。
          </p>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {me?.email}
          {me?.tenant_name ? `（${me.tenant_name}）` : ""}
        </p>
        {error && <div className="login-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </div>
  );
}

function Sidebar() {
  const navigate = useNavigate();
  const { me } = useMe();
  const { unread } = useUnread();
  const [profile, setProfile] = useState(false);
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
        <div className="brand-mark"><IoDocumentText /></div>
        <div className="brand-text">
          <strong>紙ログ</strong>
          <span>Document Management</span>
        </div>
      </div>

      <nav className="nav">
        {nav.map((n) => {
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
            >
              <span className="icon"><Icon /></span>
              {n.label}
              {n.badge && unread > 0 && <span className="nav-badge">{unread > 99 ? "99+" : unread}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <a
          href={ISSUE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="nav-item"
        >
          <span className="icon"><IoBugOutline /></span>
          バグ報告
        </a>
        <button
          className="user-chip"
          onClick={() => setProfile(true)}
          disabled={!me}
          title="表示名を変更"
        >
          <div className="avatar">{initial}</div>
          <div className="meta">
            <strong>{me ? `${me.name}（${ROLE_LABEL[me.role] ?? me.role}）` : "—"}</strong>
            <span>{me?.tenant_name ? `${me.tenant_name} / ${me.email}` : me?.email ?? ""}</span>
          </div>
        </button>
        {profile && <ProfileModal onClose={() => setProfile(false)} />}
        <button className="btn-logout" onClick={logout}>
          <IoLogOutOutline />
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

// 全体管理者は操作するテナントを選ぶまで、テナント管理以外の画面を使えない（API が 409 を返す）
function TenantNotice() {
  const { me } = useMe();
  const location = useLocation();
  if (me?.role !== "super_admin" || me.tenant_id || location.pathname === "/tenants") return null;
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      操作するテナントが選ばれていません。<Link to="/tenants">テナント管理</Link>で「このテナントを操作」を選んでください。
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
        <div className="content">
          <TenantNotice />
          {children}
        </div>
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
              path="/categories"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Shell title="カテゴリ管理" description="書類のカテゴリと、カテゴリごとに見られる人の範囲を決めます">
                      <CategoriesPage />
                    </Shell>
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/storage"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Shell title="保存先" description="書類の画像・PDF の保存先を選びます（Cloudflare R2 / Google ドライブ / Synology NAS）">
                      <StoragePage />
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
                    <Shell title="テナント管理" description="利用者ごとのデータ分離の単位です。操作するテナントの切り替えとメンバーの移動もここで行います">
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
