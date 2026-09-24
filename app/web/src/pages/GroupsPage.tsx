import { useEffect, useState } from "react";
import {
  listGroups,
  createGroup,
  deleteGroup,
  listGroupMembers,
  addGroupMember,
  removeGroupMember,
  listUsers,
  apiErrorMessage as errMsg,
  type Group,
  type GroupMember,
  type User,
} from "../api/client";

// グループのマスタ管理 (F-36 自動共有の単位)
export function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [membersOf, setMembersOf] = useState<Group | null>(null);

  function reload() {
    return listGroups()
      .then(setGroups)
      .catch(() => setError("グループ一覧の取得に失敗しました。"));
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const g = await createGroup({ name: name.trim(), description: description.trim() || null });
      setGroups((prev) => [...prev, g]);
      setName("");
      setDescription("");
    } catch (e: any) {
      alert(errMsg(e, "グループの作成に失敗しました。"));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(g: Group) {
    if (!window.confirm(`グループ「${g.name}」を削除しますか？（所属関係も解除されます）`)) return;
    try {
      await deleteGroup(g.id);
      setGroups((prev) => prev.filter((x) => x.id !== g.id));
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
      <form className="card card-pad" onSubmit={onCreate} style={{ marginBottom: 20 }}>
        <div className="acl-row" style={{ border: "none", background: "transparent", padding: 0 }}>
          <input className="input" placeholder="グループ名（例: 営業部）" required value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
          <input className="input" placeholder="説明（任意）" value={description} onChange={(e) => setDescription(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={creating}>
            {creating ? "作成中…" : "＋ グループ追加"}
          </button>
        </div>
      </form>

      {error && <div className="login-error">{error}</div>}

      <div className="card table-wrap">
        {groups.length === 0 ? (
          <div className="state">
            <div className="emoji">👥</div>
            <h3>グループがありません</h3>
            <p>上のフォームからグループを作成し、メンバーを追加してください。</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>グループ名</th>
                <th>説明</th>
                <th>メンバー数</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="cell-title">{g.name}</td>
                  <td>{g.description ?? <span style={{ color: "var(--text-subtle)" }}>—</span>}</td>
                  <td>{g.member_count}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm" onClick={() => setMembersOf(g)}>
                      メンバー管理
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(g)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {membersOf && (
        <MembersModal
          group={membersOf}
          onClose={() => {
            setMembersOf(null);
            reload(); // member_count を更新
          }}
        />
      )}
    </section>
  );
}

function MembersModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    return listGroupMembers(group.id).then(setMembers);
  }

  useEffect(() => {
    Promise.all([reload(), listUsers().then(setAllUsers)]).finally(() => setLoading(false));
  }, [group.id]);

  const memberIds = new Set(members.map((m) => m.user_id));
  const candidates = allUsers.filter((u) => !memberIds.has(u.id));

  async function add(userId: string) {
    setBusyId(userId);
    try {
      await addGroupMember(group.id, userId);
      await reload();
    } catch (e: any) {
      alert(errMsg(e, "追加に失敗しました。"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(userId: string) {
    setBusyId(userId);
    try {
      await removeGroupMember(group.id, userId);
      await reload();
    } catch (e: any) {
      alert(errMsg(e, "削除に失敗しました。"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>メンバー管理</h2>
        <p style={{ color: "var(--text-muted)", marginTop: -4 }}>{group.name}</p>

        {loading ? (
          <div className="state">
            <div className="spinner" />
          </div>
        ) : (
          <>
            <div className="section-title" style={{ marginTop: 8 }}>所属メンバー（{members.length}）</div>
            <div className="acl-list">
              {members.length === 0 && <p style={{ color: "var(--text-subtle)" }}>まだメンバーがいません。</p>}
              {members.map((m) => (
                <div className="acl-row" key={m.user_id}>
                  <div className="acl-user">
                    <strong>{m.name}</strong>
                    <span>{m.email}</span>
                  </div>
                  <button className="btn btn-sm btn-danger" disabled={busyId === m.user_id} onClick={() => remove(m.user_id)}>
                    外す
                  </button>
                </div>
              ))}
            </div>

            <div className="section-title" style={{ marginTop: 18 }}>追加できるユーザー</div>
            <div className="acl-list">
              {candidates.length === 0 && <p style={{ color: "var(--text-subtle)" }}>追加できるユーザーがいません。</p>}
              {candidates.map((u) => (
                <div className="acl-row" key={u.id}>
                  <div className="acl-user">
                    <strong>{u.name}</strong>
                    <span>{u.email}</span>
                  </div>
                  <button className="btn btn-sm" disabled={busyId === u.id} onClick={() => add(u.id)}>
                    追加
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
