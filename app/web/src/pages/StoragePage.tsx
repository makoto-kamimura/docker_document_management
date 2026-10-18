import { useEffect, useState } from "react";
import {
  getStorageOverview,
  createStorageBackend,
  updateStorageBackend,
  deleteStorageBackend,
  testStorageBackend,
  setActiveStorage,
  googleAuthorizeUrl,
  apiErrorMessage as errMsg,
  STORAGE_PRESET_LABEL,
  type StorageBackend,
  type StorageOverview,
  type StoragePreset,
} from "../api/client";

type ManualPreset = Exclude<StoragePreset, "gdrive">;

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;     // 認証情報（暗号化して保存。編集時は空なら据え置き）
  optional?: boolean;
}

// 種類ごとの入力項目（バックエンドの routes/storage.py の _PRESETS と対応）
const FIELDS: Record<ManualPreset, FieldDef[]> = {
  r2: [
    { key: "account_id", label: "アカウント ID", placeholder: "Cloudflare ダッシュボードの R2 概要に表示" },
    { key: "bucket", label: "バケット名", placeholder: "kamilog" },
    { key: "access_key", label: "アクセスキー ID", secret: true },
    { key: "secret_key", label: "シークレットアクセスキー", secret: true },
    { key: "prefix", label: "保存先フォルダ", placeholder: "dms/（既定）", optional: true },
  ],
  synology: [
    { key: "url", label: "WebDAV の URL", placeholder: "https://nas.local:5006/home/kamilog" },
    { key: "username", label: "ユーザー名", secret: true },
    { key: "password", label: "パスワード", secret: true },
    { key: "prefix", label: "保存先フォルダ", placeholder: "dms/（既定）", optional: true },
  ],
  s3: [
    { key: "endpoint", label: "エンドポイント", placeholder: "https://s3.example.com" },
    { key: "region", label: "リージョン", placeholder: "us-east-1", optional: true },
    { key: "bucket", label: "バケット名" },
    { key: "access_key", label: "アクセスキー", secret: true },
    { key: "secret_key", label: "シークレットキー", secret: true },
    { key: "prefix", label: "保存先フォルダ", placeholder: "dms/（既定）", optional: true },
  ],
};

// 自分で設置する保存先だけ「自宅内（オンプレ）」にできる（R2・Google ドライブは常にクラウド扱い）
const ONPREM_CAPABLE: ManualPreset[] = ["synology", "s3"];

function StatusBadge({ b }: { b: StorageBackend }) {
  if (b.last_test_ok === true) return <span className="badge badge-done">接続OK</span>;
  if (b.last_test_ok === false) {
    return (
      <span className="badge badge-failed" title={b.last_test_error ?? ""}>
        {b.preset === "gdrive" ? "要再連携" : "接続エラー"}
      </span>
    );
  }
  return <span className="badge badge-neutral">未テスト</span>;
}

function describe(b: StorageBackend): string {
  const c = b.config;
  if (b.preset === "gdrive") return c.account_email ? `${c.account_email} の「紙ログ」フォルダ` : "「紙ログ」フォルダ";
  if (b.preset === "r2") return `バケット ${c.bucket}`;
  if (b.preset === "synology") return c.url;
  return `${c.endpoint} / ${c.bucket}`;
}

/** 保存先の追加・編集フォーム（モーダル）。 */
function BackendForm({
  preset,
  editing,
  onClose,
  onSaved,
}: {
  preset: ManualPreset;
  editing: StorageBackend | null;
  onClose: () => void;
  onSaved: (ok: boolean, msg: string) => void;
}) {
  const fields = FIELDS[preset];
  const [name, setName] = useState(editing?.name ?? STORAGE_PRESET_LABEL[preset]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) if (!f.secret) v[f.key] = editing?.config?.[f.key] ?? "";
    return v;
  });
  const [verifyTls, setVerifyTls] = useState<boolean>(editing?.config?.verify_tls ?? true);
  const [isOnprem, setIsOnprem] = useState<boolean>(editing ? editing.is_onprem : preset === "synology");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const config: Record<string, any> = {};
    const secret: Record<string, string> = {};
    for (const f of fields) {
      const v = (values[f.key] ?? "").trim();
      if (f.secret) {
        if (v) secret[f.key] = v;
      } else {
        config[f.key] = v;
      }
    }
    if (preset === "synology") config.verify_tls = verifyTls;
    try {
      const res = editing
        ? await updateStorageBackend(editing.id, { name, config, secret, is_onprem: isOnprem })
        : await createStorageBackend({ preset, name, config, secret, is_onprem: isOnprem });
      onSaved(
        res.ok,
        res.ok
          ? `「${res.backend.name}」を保存し、接続テストに成功しました。`
          : `「${res.backend.name}」を保存しましたが、接続テストに失敗しました: ${res.error}`
      );
    } catch (e: any) {
      setError(errMsg(e, "保存に失敗しました。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2>
          {STORAGE_PRESET_LABEL[preset]}を{editing ? "編集" : "追加"}
        </h2>
        {error && <div className="login-error">{error}</div>}
        <div className="field">
          <label>表示名</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label>
              {f.label}
              {f.optional && <span className="muted">（任意）</span>}
            </label>
            <input
              className="input"
              type={f.secret && f.key !== "username" && f.key !== "access_key" ? "password" : "text"}
              autoComplete="off"
              required={!f.optional && !(f.secret && editing)}
              value={values[f.key] ?? ""}
              placeholder={f.secret && editing ? "変更する場合のみ入力" : f.placeholder}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        {preset === "synology" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <input type="checkbox" checked={verifyTls} onChange={(e) => setVerifyTls(e.target.checked)} />
            証明書を検証する（自己署名証明書のまま使う場合だけ外す）
          </label>
        )}
        {ONPREM_CAPABLE.includes(preset) && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <input type="checkbox" checked={isOnprem} onChange={(e) => setIsOnprem(e.target.checked)} />
            <span>
              自宅内（オンプレ）の保存先として扱う
              <br />
              <span className="muted">チェックすると「機密」の書類もここへ保存します。</span>
            </span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "接続テスト中…" : "保存して接続テスト"}
          </button>
        </div>
      </form>
    </div>
  );
}

// 書類の保存先（外部ストレージ連携）。テナント管理者が保存先を登録し、1つを使用中にする。
export function StoragePage() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<{ preset: ManualPreset; editing: StorageBackend | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    return getStorageOverview()
      .then((o) => {
        setOverview(o);
        setError(null);
      })
      .catch((e) => setError(errMsg(e, "保存先の取得に失敗しました。")));
  }

  useEffect(() => {
    // Google の同意画面から戻ってきたときの結果表示
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (google) {
      setNotice(
        google === "ok"
          ? { ok: true, text: "Google ドライブと連携しました。「この保存先を使う」で切り替えられます。" }
          : { ok: false, text: params.get("message") ?? "Google ドライブと連携できませんでした。" }
      );
      window.history.replaceState(null, "", window.location.pathname);
    }
    reload().finally(() => setLoading(false));
  }, []);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
    } catch (e: any) {
      setNotice({ ok: false, text: errMsg(e, "操作に失敗しました。") });
    } finally {
      setBusy(null);
    }
  }

  const onActivate = (b: StorageBackend | null) =>
    run(b?.id ?? "default", async () => {
      setOverview(await setActiveStorage(b?.id ?? null));
      setNotice({
        ok: true,
        text: `これから登録する書類は「${b ? b.name : "既定の保存先"}」に保存します。登録済みの書類は元の保存先のままです。`,
      });
    });

  const onTest = (b: StorageBackend) =>
    run(b.id, async () => {
      const res = await testStorageBackend(b.id);
      setNotice(res.ok ? { ok: true, text: `「${b.name}」に接続できました。` } : { ok: false, text: `接続テストに失敗しました: ${res.error}` });
      await reload();
    });

  const onDelete = (b: StorageBackend) => {
    if (!window.confirm(`保存先「${b.name}」を削除しますか？（保存先にあるファイルは消えません）`)) return;
    run(b.id, async () => {
      await deleteStorageBackend(b.id);
      await reload();
    });
  };

  const onGoogle = (b?: StorageBackend) =>
    run(b?.id ?? "google", async () => {
      window.location.assign(await googleAuthorizeUrl(b?.id));
    });

  if (loading) {
    return (
      <div className="state">
        <div className="spinner" />
        <p>読み込み中…</p>
      </div>
    );
  }
  if (!overview) return <div className="login-error">{error ?? "保存先の取得に失敗しました。"}</div>;

  const active = overview.backends.find((b) => b.id === overview.active_backend_id) ?? null;
  const editable = overview.editable && overview.secret_key_configured;

  return (
    <section>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <p style={{ margin: 0 }}>
          撮影した書類の画像・PDF を保存する場所を選べます。<strong>使用中の保存先は、これから登録する書類</strong>
          に使われ、登録済みの書類は元の保存先から読み込みます。
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          「機密」の書類は、自宅内（オンプレ）として登録した保存先にだけ保存します。それ以外を使用中のときは
          サーバー内の保存先に置きます。
        </p>
        <p style={{ marginBottom: 0 }}>
          使用中: <strong>{active ? active.name : "既定（サーバー内の保存先）"}</strong>
        </p>
      </div>

      {notice && (
        <div className={notice.ok ? "card state-ok" : "login-error"} style={notice.ok ? { padding: 12, marginBottom: 16 } : undefined}>
          {notice.text}
        </div>
      )}
      {error && <div className="login-error">{error}</div>}
      {!overview.editable && (
        <div className="card state-info" style={{ padding: 12, marginBottom: 16 }}>
          デモテナントでは保存先を変更できません。
        </div>
      )}
      {overview.editable && !overview.secret_key_configured && (
        <div className="login-error">
          サーバーに STORAGE_SECRET_KEY が設定されていないため、外部の保存先を登録できません。
        </div>
      )}

      {editable && (
        <div className="toolbar" style={{ justifyContent: "flex-start" }}>
          <button className="btn btn-primary" onClick={() => setForm({ preset: "r2", editing: null })}>
            ＋ Cloudflare R2
          </button>
          <button
            className="btn btn-primary"
            disabled={!overview.google_enabled || busy === "google"}
            title={overview.google_enabled ? "" : "サーバーで Google の OAuth クライアントが設定されていません"}
            onClick={() => onGoogle()}
          >
            ＋ Google ドライブと連携
          </button>
          <button className="btn btn-primary" onClick={() => setForm({ preset: "synology", editing: null })}>
            ＋ Synology NAS
          </button>
          <button className="btn" onClick={() => setForm({ preset: "s3", editing: null })}>
            ＋ その他の S3 互換
          </button>
        </div>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>保存先</th>
              <th>種類</th>
              <th>状態</th>
              <th>書類</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="cell-title">
                既定（サーバー内の保存先）
                {!active && <span className="tag-self">使用中</span>}
              </td>
              <td>MinIO</td>
              <td>
                <span className="badge badge-done">利用可</span>
              </td>
              <td className="muted">—</td>
              <td style={{ textAlign: "right" }}>
                {overview.editable && (
                  <button className="btn btn-sm" disabled={!active || busy !== null} onClick={() => onActivate(null)}>
                    この保存先を使う
                  </button>
                )}
              </td>
            </tr>
            {overview.backends.map((b) => (
              <tr key={b.id}>
                <td className="cell-title">
                  {b.name}
                  {b.is_active && <span className="tag-self">使用中</span>}
                  {b.is_onprem && <span className="tag-self">自宅内</span>}
                  <div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                    {describe(b)}
                  </div>
                </td>
                <td>{STORAGE_PRESET_LABEL[b.preset] ?? b.preset}</td>
                <td>
                  <StatusBadge b={b} />
                </td>
                <td>{b.document_count}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {overview.editable && (
                    <button
                      className="btn btn-sm"
                      disabled={b.is_active || !b.last_test_ok || busy !== null}
                      title={b.last_test_ok ? "" : "接続テストに成功すると選べます"}
                      onClick={() => onActivate(b)}
                    >
                      この保存先を使う
                    </button>
                  )}
                  <button className="btn btn-sm" disabled={busy !== null} onClick={() => onTest(b)}>
                    {busy === b.id ? "確認中…" : "接続テスト"}
                  </button>
                  {editable && b.preset === "gdrive" && (
                    <button className="btn btn-sm" disabled={busy !== null} onClick={() => onGoogle(b)}>
                      再連携
                    </button>
                  )}
                  {editable && b.preset !== "gdrive" && (
                    <button
                      className="btn btn-sm"
                      onClick={() => setForm({ preset: b.preset as ManualPreset, editing: b })}
                    >
                      編集
                    </button>
                  )}
                  {editable && (
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={b.document_count > 0 || busy !== null}
                      title={b.document_count > 0 ? "書類が保存されている保存先は削除できません" : ""}
                      onClick={() => onDelete(b)}
                    >
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <BackendForm
          preset={form.preset}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={(ok, text) => {
            setForm(null);
            setNotice({ ok, text });
            reload();
          }}
        />
      )}
    </section>
  );
}
