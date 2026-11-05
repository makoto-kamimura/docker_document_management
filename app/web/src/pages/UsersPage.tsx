import { useEffect, useState } from "react";
import {
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  apiErrorMessage as errMsg,
  ASSIGNABLE_ROLES as ROLES,
  ROLE_LABEL,
  type User,
  type Role,
} from "../api/client";
import { useMe } from "../me";

// ユーザー・権限のマスタ管理 (F-35, F-38)。操作中のテナントのユーザーだけを扱う
// （全体管理者も同じ。テナント間の移動はテナント管理で行う）
export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const { me, setMe } = useMe();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function reload() {
    return listUsers()
      .then(setUsers)
      .catch(() => setError("ユーザー一覧の取得に失敗しました。"));
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  const admins = users.filter((u) => u.role === "admin");

  async function changeRole(u: User, role: Role) {
    try {
      const updated = await updateUser(u.id, { role });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (e: any) {
      alert(errMsg(e, "ロールの変更に失敗しました。"));
    }
  }

  // 子供の印。公開範囲が「子供以外」のカテゴリの書類が見えなくなる
  async function changeChild(u: User, isChild: boolean) {
    try {
      const updated = await updateUser(u.id, { is_child: isChild });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (e: any) {
      alert(errMsg(e, "子供の設定の変更に失敗しました。"));
    }
  }

  async function onRename(u: User) {
    const next = window.prompt("表示名", u.name)?.trim();
    if (!next || next === u.name) return;
    try {
      const updated = await updateUser(u.id, { name: next });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
      if (me?.id === u.id) setMe({ ...me, name: updated.name }); // サイドバーの名前も変える
    } catch (e: any) {
      alert(errMsg(e, "名前の変更に失敗しました。"));
    }
  }

  async function onResetPassword(u: User) {
    const pw = window.prompt(`「${u.name}」の新しいパスワードを入力してください（4文字以上）`);
    if (!pw) return;
    try {
      await resetUserPassword(u.id, pw);
      alert("パスワードを更新しました。");
    } catch (e: any) {
      alert(errMsg(e, "パスワードの更新に失敗しました。"));
    }
  }

  async function onDelete(u: User) {
    if (!window.confirm(`ユーザー「${u.name}（${u.email}）」を削除しますか？`)) return;
    try {
      await deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e: any) {
      alert(errMsg(e, "削除に失敗しました。"));
    }
  }

  if (loading) {
    return (
      <div className="state">
        <div className="spinner" />
        <p>読み込み中…</p>
      </div>
    );
  }

  return (
    <section>
      <div className="toolbar">
        <div className="stats" style={{ margin: 0 }}>
          <div className="stat">
            <div className="label">ユーザー総数</div>
            <div className="value">{users.length}</div>
          </div>
          <div className="stat">
            <div className="label">管理者</div>
            <div className="value">{admins.length}</div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          ＋ ユーザーを追加
        </button>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>氏名</th>
              <th>メールアドレス</th>
              <th>ロール</th>
              <th title="「子供以外」のカテゴリの書類を見られません">子供</th>
              <th>作成日</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = me?.id === u.id;
              const isLastAdmin = u.role === "admin" && admins.length <= 1;
              const isSuperUser = u.role === "super_admin";
              const lockRole = isSelf || isLastAdmin || isSuperUser;
              return (
                <tr key={u.id}>
                  <td className="cell-title">
                    {u.name}
                    {isSelf && <span className="tag-self">あなた</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    {isSuperUser ? (
                      ROLE_LABEL[u.role]
                    ) : (
                      <select
                        className="select"
                        value={u.role}
                        disabled={lockRole}
                        title={lockRole ? "自分自身・テナント最後の管理者は変更できません" : ""}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.is_child}
                      disabled={isSuperUser}
                      aria-label={`${u.name}を子供にする`}
                      onChange={(e) => changeChild(u, e.target.checked)}
                    />
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString("ja-JP")}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm" onClick={() => onRename(u)}>
                      名前変更
                    </button>
                    <button className="btn btn-sm" onClick={() => onResetPassword(u)}>
                      PWリセット
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={lockRole}
                      title={lockRole ? "自分自身・テナント最後の管理者・全体管理者は削除できません" : ""}
                      onClick={() => onDelete(u)}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(u) => {
            setUsers((prev) => [...prev, u]);
            setShowCreate(false);
          }}
        />
      )}
    </section>
  );
}

// 作成したユーザーは操作中のテナントに所属する
function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (u: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [isChild, setIsChild] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const u = await createUser({
        email: email.trim(),
        name: name.trim(),
        role,
        password,
        is_child: isChild,
      });
      onCreated(u);
    } catch (e: any) {
      setError(errMsg(e, "ユーザーの作成に失敗しました。"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>ユーザーを追加</h2>
        {error && <div className="login-error">{error}</div>}

        <div className="field">
          <label>メールアドレス</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </div>
        <div className="field">
          <label>氏名</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>ロール</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <input type="checkbox" checked={isChild} onChange={(e) => setIsChild(e.target.checked)} />
          子供（公開範囲が「子供以外」のカテゴリの書類を見られません）
        </label>
        <div className="field">
          <label>初期パスワード（4文字以上）</label>
          <input className="input" type="text" required minLength={4} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="管理者が設定" />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "作成中…" : "作成"}
          </button>
        </div>
      </form>
    </div>
  );
}
