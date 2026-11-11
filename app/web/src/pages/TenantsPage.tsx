import { useEffect, useState } from "react";
import {
  listTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  switchTenant,
  listTenantUsers,
  moveUserToTenant,
  apiErrorMessage as errMsg,
  ROLE_LABEL,
  type Tenant,
  type User,
} from "../api/client";
import { useMe } from "../me";

// テナント（データ分離の単位）の管理。全体管理者のみ表示される。
// テナントをまたぐ操作（作成・変更・削除、操作するテナントの切り替え、メンバーの移動）はこの画面にだけある。
export function TenantsPage() {
  const { me } = useMe();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [membersOf, setMembersOf] = useState<Tenant | null>(null);
  // 全体管理者の /auth/me は操作中のテナントを返す
  const active = me?.tenant_id ?? null;

  function reload() {
    return listTenants()
      .then(setTenants)
      .catch(() => setError("テナント一覧の取得に失敗しました。"));
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const t = await createTenant({
        slug: slug.trim(),
        name: name.trim(),
        is_demo: isDemo,
      });
      setTenants((prev) => [...prev, t]);
      setSlug("");
      setName("");
      setIsDemo(false);
    } catch (e: any) {
      alert(errMsg(e, "テナントの作成に失敗しました。"));
    } finally {
      setCreating(false);
    }
  }

  async function onRename(t: Tenant) {
    const next = window.prompt("テナント名", t.name);
    if (!next || next === t.name) return;
    try {
      const updated = await updateTenant(t.id, { name: next });
      setTenants((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
    } catch (e: any) {
      alert(errMsg(e, "更新に失敗しました。"));
    }
  }

  async function onDelete(t: Tenant) {
    if (!window.confirm(`テナント「${t.name}」を削除しますか？（空のテナントのみ削除できます）`)) return;
    try {
      await deleteTenant(t.id);
      setTenants((prev) => prev.filter((x) => x.id !== t.id));
      // 操作中のテナントを消したら未選択に戻る
      if (active === t.id) window.location.reload();
    } catch (e: any) {
      alert(errMsg(e, "削除に失敗しました。"));
    }
  }

  // 切り替えるとデータを取り直すため再読込する（Web・モバイルとも次の操作からこのテナントになる）
  async function onSwitch(t: Tenant) {
    try {
      await switchTenant(t.id);
      window.location.reload();
    } catch (e: any) {
      alert(errMsg(e, "切り替えに失敗しました。"));
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
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <p style={{ margin: 0 }}>
          テナントは<strong>データ分離の単位</strong>です。ユーザー・グループ・カテゴリ・ドキュメント・通知は
          いずれか1つのテナントに属し、一覧・検索・通知はすべてテナントで絞り込まれます。
          全体管理者も、ここで選んだ<strong>1つのテナントの中</strong>で、他のユーザーと同じように操作します
          （モバイルアプリも同じテナントを使います）。
        </p>
        <p style={{ marginBottom: 0 }}>
          操作中のテナント:{" "}
          <strong>{active ? tenants.find((t) => t.id === active)?.name ?? "—" : "未選択"}</strong>
          {!active && <span className="muted">（下の一覧の「このテナントを操作」で選んでください）</span>}
        </p>
      </div>

      {error && <div className="login-error">{error}</div>}

      <form className="toolbar" onSubmit={onCreate}>
        <input
          className="input"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="識別子（英小文字/数字, 例: tanaka-ke）"
          pattern="[a-z0-9][a-z0-9_-]*"
          title="英小文字・数字・ハイフン・アンダースコア"
        />
        <input
          className="input"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="表示名（例: 田中家）"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} />
          デモ用
        </label>
        <button className="btn btn-primary" type="submit" disabled={creating}>
          ＋ テナントを追加
        </button>
      </form>
      <p className="muted" style={{ marginTop: -4 }}>
        新しいテナントには、サンプルのカテゴリ「投函チラシ（全員）」「重要書類（子供以外）」「処方箋（本人だけ）」「取扱説明書（全員）」を用意します。
      </p>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>テナント</th>
              <th>識別子</th>
              <th>ユーザー</th>
              <th>ドキュメント</th>
              <th>作成日</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td className="cell-title">
                  {t.name}
                  {t.is_demo && <span className="tag-self">デモ</span>}
                  {active === t.id && <span className="tag-self">操作中</span>}
                </td>
                <td>
                  <code>{t.slug}</code>
                </td>
                <td>{t.user_count}</td>
                <td>{t.document_count}</td>
                <td>{new Date(t.created_at).toLocaleDateString("ja-JP")}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn btn-sm" onClick={() => onSwitch(t)} disabled={active === t.id}>
                    このテナントを操作
                  </button>
                  <button className="btn btn-sm" onClick={() => setMembersOf(t)}>
                    メンバー
                  </button>
                  <button className="btn btn-sm" onClick={() => onRename(t)}>
                    名称変更
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={t.user_count > 0 || t.document_count > 0}
                    title={t.user_count > 0 || t.document_count > 0 ? "中身のあるテナントは削除できません" : ""}
                    onClick={() => onDelete(t)}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {membersOf && (
        <MembersModal
          tenant={membersOf}
          tenants={tenants}
          onMoved={reload}
          onClose={() => setMembersOf(null)}
        />
      )}
    </section>
  );
}

// テナントのメンバーの確認と、別のテナントへの移動
function MembersModal({
  tenant,
  tenants,
  onMoved,
  onClose,
}: {
  tenant: Tenant;
  tenants: Tenant[];
  onMoved: () => void;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const others = tenants.filter((t) => t.id !== tenant.id);

  useEffect(() => {
    listTenantUsers(tenant.id)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [tenant.id]);

  async function move(u: User, toId: string) {
    const to = others.find((t) => t.id === toId);
    if (!to) return;
    if (
      !window.confirm(
        `「${u.name}」を テナント「${to.name}」へ移動しますか？\n` +
          "本人が登録したドキュメントと通知も一緒に移ります。" +
          "テナントをまたぐグループ所属・個別共有は解除されます。"
      )
    )
      return;
    setBusyId(u.id);
    try {
      await moveUserToTenant(to.id, u.id);
      setMembers((prev) => prev.filter((x) => x.id !== u.id));
      onMoved();
    } catch (e: any) {
      alert(errMsg(e, "テナントの変更に失敗しました。"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>メンバー</h2>
        <p style={{ color: "var(--text-muted)", marginTop: -4 }}>{tenant.name}</p>

        {loading ? (
          <div className="state">
            <div className="spinner" />
          </div>
        ) : (
          <div className="acl-list">
            {members.length === 0 && <p style={{ color: "var(--text-subtle)" }}>メンバーがいません。</p>}
            {members.map((u) => (
              <div className="acl-row" key={u.id}>
                <div className="acl-user">
                  <strong>
                    {u.name}（{ROLE_LABEL[u.role]}
                    {u.is_child ? "・子供" : ""}）
                  </strong>
                  <span>{u.email}</span>
                </div>
                <select
                  className="select"
                  value=""
                  disabled={busyId === u.id || others.length === 0}
                  onChange={(e) => move(u, e.target.value)}
                  aria-label={`${u.name}の移動先`}
                >
                  <option value="">移動先…</option>
                  {others.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
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
