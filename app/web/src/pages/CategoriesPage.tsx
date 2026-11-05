import { useEffect, useState } from "react";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  apiErrorMessage as errMsg,
  VISIBILITY_HELP,
  VISIBILITY_LABEL,
  VISIBILITY_ORDER,
  type Category,
  type CategoryVisibility,
} from "../api/client";
import { IoFolderOutline } from "react-icons/io5";
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CategoryIcon,
  DEFAULT_COLOR,
  DEFAULT_ICON,
  categoryColor,
} from "../categoryStyle";

const VISIBILITIES: CategoryVisibility[] = ["everyone", "adults", "family", "owner"];

function VisibilitySelect({
  value,
  onChange,
}: {
  value: CategoryVisibility;
  onChange: (v: CategoryVisibility) => void;
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as CategoryVisibility)}>
      {VISIBILITIES.map((v) => (
        <option key={v} value={v}>
          {VISIBILITY_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

// アイコンと色を選ぶ。選んだ色でアイコンの見本を塗る
function StylePicker({
  icon,
  color,
  onChange,
}: {
  icon: string;
  color: string;
  onChange: (icon: string, color: string) => void;
}) {
  const c = categoryColor(color);
  return (
    <div className="style-picker">
      <div className="icon-grid" role="radiogroup" aria-label="アイコン">
        {CATEGORY_ICONS.map(({ key, Icon }) => (
          <button
            type="button"
            key={key}
            role="radio"
            aria-checked={icon === key}
            aria-label={key}
            className={"icon-choice" + (icon === key ? " active" : "")}
            style={icon === key ? { color: c.fg, background: c.bg } : undefined}
            onClick={() => onChange(key, color)}
          >
            <Icon />
          </button>
        ))}
      </div>
      <div className="swatches" role="radiogroup" aria-label="色">
        {CATEGORY_COLORS.map((k) => (
          <button
            type="button"
            key={k.key}
            role="radio"
            aria-checked={color === k.key}
            aria-label={k.label}
            title={k.label}
            className={"swatch" + (color === k.key ? " active" : "")}
            style={{ background: k.fg }}
            onClick={() => onChange(icon, k.key)}
          />
        ))}
      </div>
    </div>
  );
}

// 登録済みカテゴリのアイコン・色の変更
function StyleModal({
  category,
  onSave,
  onClose,
}: {
  category: Category;
  onSave: (icon: string, color: string) => Promise<void>;
  onClose: () => void;
}) {
  const [icon, setIcon] = useState(category.icon ?? DEFAULT_ICON);
  const [color, setColor] = useState(category.color ?? DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await onSave(icon, color);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="cat-name-cell">
          <CategoryIcon icon={icon} color={color} size={36} />
          {category.name}
        </h2>
        <StylePicker icon={icon} color={color} onChange={(i, c) => { setIcon(i); setColor(c); }} />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// カテゴリのマスタ管理 (F-17, F-39)。カテゴリごとに、中の書類を見られる人の範囲を決める（管理者のみ）
export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<CategoryVisibility>("family");
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [creating, setCreating] = useState(false);
  const [styling, setStyling] = useState<Category | null>(null);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => setError("カテゴリ一覧の取得に失敗しました。"))
      .finally(() => setLoading(false));
  }, []);

  function replace(updated: Category) {
    setCategories((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const c = await createCategory({ name: name.trim(), visibility, icon, color });
      setCategories((prev) => [...prev, c]);
      setName("");
      setVisibility("family");
      setIcon(DEFAULT_ICON);
      setColor(DEFAULT_COLOR);
    } catch (e: any) {
      alert(errMsg(e, "カテゴリの作成に失敗しました。"));
    } finally {
      setCreating(false);
    }
  }

  async function onChangeVisibility(c: Category, next: CategoryVisibility) {
    // 範囲を広げると、今は見えていない人にもこのカテゴリの書類が見えるようになる
    const widens = VISIBILITY_ORDER.indexOf(next) > VISIBILITY_ORDER.indexOf(c.visibility);
    if (
      widens &&
      !window.confirm(
        `「${c.name}」の見られる人を「${VISIBILITY_LABEL[next]}」に広げますか？\n` +
          `${VISIBILITY_HELP[next]}。登録済みの書類にもすぐに反映されます。`
      )
    )
      return;
    try {
      replace(await updateCategory(c.id, { visibility: next }));
    } catch (e: any) {
      alert(errMsg(e, "更新に失敗しました。"));
    }
  }

  async function onRename(c: Category) {
    const next = window.prompt("カテゴリ名", c.name)?.trim();
    if (!next || next === c.name) return;
    try {
      replace(await updateCategory(c.id, { name: next }));
    } catch (e: any) {
      alert(errMsg(e, "更新に失敗しました。"));
    }
  }

  async function onSaveStyle(c: Category, nextIcon: string, nextColor: string) {
    try {
      replace(await updateCategory(c.id, { icon: nextIcon, color: nextColor }));
      setStyling(null);
    } catch (e: any) {
      alert(errMsg(e, "更新に失敗しました。"));
    }
  }

  async function onDelete(c: Category) {
    if (!window.confirm(`カテゴリ「${c.name}」を削除しますか？（書類が入っていないカテゴリだけ削除できます）`)) return;
    try {
      await deleteCategory(c.id);
      setCategories((prev) => prev.filter((x) => x.id !== c.id));
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
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <p style={{ margin: 0 }}>
          撮影した書類はカテゴリに入れて保管します。カテゴリの<strong>見られる人</strong>が、その中の書類を見られる人の上限です
          （管理者・全体管理者にも当てはまります）。カテゴリを選ばなかった書類は「家族」と同じ扱いです。
        </p>
        <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
          {VISIBILITIES.map((v) => (
            <li key={v}>
              <strong>{VISIBILITY_LABEL[v]}</strong>: {VISIBILITY_HELP[v]}
            </li>
          ))}
        </ul>
      </div>

      <form className="card card-pad" onSubmit={onCreate} style={{ marginBottom: 20 }}>
        <div className="acl-row" style={{ border: "none", background: "transparent", padding: 0 }}>
          <CategoryIcon icon={icon} color={color} size={36} />
          <input
            className="input"
            placeholder="カテゴリ名（例: 学校）"
            required
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <VisibilitySelect value={visibility} onChange={setVisibility} />
          <button className="btn btn-primary" disabled={creating}>
            {creating ? "作成中…" : "＋ カテゴリ追加"}
          </button>
        </div>
        <div style={{ marginTop: 14 }}>
          <StylePicker icon={icon} color={color} onChange={(i, c) => { setIcon(i); setColor(c); }} />
        </div>
      </form>

      {error && <div className="login-error">{error}</div>}

      <div className="card table-wrap">
        {categories.length === 0 ? (
          <div className="state">
            <IoFolderOutline className="state-icon" />
            <h3>カテゴリがありません</h3>
            <p>上のフォームからカテゴリを作成してください。</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>カテゴリ</th>
                <th>見られる人</th>
                <th title="自分が見られる書類の件数">書類</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="cell-title">
                    <span className="cat-name-cell">
                      <button
                        className="cat-icon-btn"
                        onClick={() => setStyling(c)}
                        title="アイコン・色を変更"
                        aria-label={`${c.name} のアイコン・色を変更`}
                      >
                        <CategoryIcon icon={c.icon} color={c.color} size={32} />
                      </button>
                      {c.name}
                    </span>
                  </td>
                  <td>
                    <VisibilitySelect value={c.visibility} onChange={(v) => onChangeVisibility(c, v)} />
                  </td>
                  <td>{c.document_count}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm" onClick={() => setStyling(c)}>
                      アイコン
                    </button>
                    <button className="btn btn-sm" onClick={() => onRename(c)}>
                      名称変更
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(c)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {styling && (
        <StyleModal
          category={styling}
          onSave={(i, c) => onSaveStyle(styling, i, c)}
          onClose={() => setStyling(null)}
        />
      )}
    </section>
  );
}
