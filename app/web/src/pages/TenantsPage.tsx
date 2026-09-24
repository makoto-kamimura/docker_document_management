import { useEffect, useState } from "react";
import {
  listTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  getActiveTenant,
  setActiveTenant,
  apiErrorMessage as errMsg,
  type Tenant,
} from "../api/client";

// テナント（データ分離の単位）のマスタ管理。全体管理者のみ表示される。
export function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [creating, setCreating] = useState(false);
  const active = getActiveTenant();

  useEffect(() => {
    listTenants()
      .then(setTenants)
      .catch(() => setError("テナント一覧の取得に失敗しました。"))
      .finally(() => setLoading(false));
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
      if (active === t.id) {
        setActiveTenant(null);
        window.location.reload();
      }
    } catch (e: any) {
      alert(errMsg(e, "削除に失敗しました。"));
    }
  }

  function onSwitch(t: Tenant | null) {
    setActiveTenant(t ? t.id : null);
    window.location.reload();
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
          テナントは<strong>データ分離の単位</strong>です。ユーザー・グループ・ドキュメント・通知は
          いずれか1つのテナントに属し、一覧・検索・通知はすべてテナントで絞り込まれます。
          テナントをまたいで見られるのは全体管理者だけです。
        </p>
        <p style={{ marginBottom: 0 }}>
          現在の操作対象:{" "}
          <strong>{active ? tenants.find((t) => t.id === active)?.name ?? "—" : "すべてのテナント"}</strong>
          {active && (
            <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => onSwitch(null)}>
              解除
            </button>
          )}
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
    </section>
  );
}
