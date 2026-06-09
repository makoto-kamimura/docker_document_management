import { useEffect, useState } from "react";
import {
  api,
  listDocuments,
  listUsers,
  listPermissions,
  upsertPermission,
  removePermission,
  listReadReceipts,
  updateDocument,
  listVersions,
  getMe,
  type DocumentRead,
  type DocumentVersion,
  type User,
  type PermissionLevel,
  type ReadReceipt,
} from "../api/client";
import { DocThumb, ViewerModal } from "../components/DocViewer";

const OCR_LABEL: Record<string, { text: string; cls: string }> = {
  done: { text: "完了", cls: "badge-done" },
  processing: { text: "処理中", cls: "badge-processing" },
  pending: { text: "待機中", cls: "badge-pending" },
  failed: { text: "失敗", cls: "badge-failed" },
};

function OcrBadge({ status }: { status: string }) {
  const m = OCR_LABEL[status] ?? { text: status, cls: "badge-neutral" };
  return <span className={`badge ${m.cls}`}>{m.text}</span>;
}

// ドキュメント一覧 (F-21)
export function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<User | null>(null);
  const [aclDoc, setAclDoc] = useState<DocumentRead | null>(null);
  const [readsDoc, setReadsDoc] = useState<DocumentRead | null>(null);
  const [editDoc, setEditDoc] = useState<DocumentRead | null>(null);
  const [viewerDoc, setViewerDoc] = useState<DocumentRead | null>(null);
  const [versionsDoc, setVersionsDoc] = useState<DocumentRead | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [view, setView] = useState<"list" | "grid">("list");

  function reload() {
    listDocuments().then(setDocs).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      listDocuments().then(setDocs),
      getMe().then(setMe).catch(() => {}),
    ])
      .catch(() => setError("一覧の取得に失敗しました。バックエンドの接続状態をご確認ください。"))
      .finally(() => setLoading(false));
  }, []);

  const canManage = (d: DocumentRead) => me?.role === "admin" || me?.id === d.owner_id;

  if (loading) {
    return (
      <div className="state">
        <div className="spinner" />
        <p>読み込み中…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state error">
        <div className="emoji">⚠️</div>
        <h3>読み込みに失敗しました</h3>
        <p>{error}</p>
      </div>
    );
  }

  const unreadCount = docs.filter((d) => !d.is_read).length;
  const shown = docs.filter((d) =>
    filter === "all" ? true : filter === "unread" ? !d.is_read : d.is_read
  );

  return (
    <section>
      {/* 未読/既読 と リスト/サムネイル の切替タブ */}
      <div className="listbar">
        <div className="seg">
          {([["all", "すべて"], ["unread", `未読${unreadCount ? ` (${unreadCount})` : ""}`], ["read", "既読"]] as const).map(
            ([key, label]) => (
              <button key={key} className={"seg-btn" + (filter === key ? " active" : "")} onClick={() => setFilter(key)}>
                {label}
              </button>
            )
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div className="seg">
          <button className={"seg-btn" + (view === "list" ? " active" : "")} onClick={() => setView("list")}>≣ リスト</button>
          <button className={"seg-btn" + (view === "grid" ? " active" : "")} onClick={() => setView("grid")}>▦ サムネイル</button>
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="card table-wrap">
          <div className="state">
            <div className="emoji">🗂️</div>
            <h3>ドキュメントがありません</h3>
            <p>モバイルアプリで紙資料を撮影するか、Web/APIからアップロードすると、ここに一覧表示されます。</p>
          </div>
        </div>
      ) : view === "grid" ? (
        <div className="thumb-grid">
          {shown.map((d) => (
            <div key={d.id} className="thumb-card" title={d.title} onClick={() => setViewerDoc(d)} style={{ cursor: "pointer" }}>
              <DocThumb id={d.id} />
              {!d.is_read && <span className="thumb-unread" />}
              <div className="thumb-cap">{d.title}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>状態</th>
                <th>OCR</th>
                <th>保存先</th>
                <th>登録日時</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td className="cell-title">
                    {d.title}
                    {d.category && <span className="chip chip-cat">{d.category}</span>}
                    {d.tags?.map((t) => (
                      <span key={t} className="chip">#{t}</span>
                    ))}
                  </td>
                  <td>
                    {d.is_read ? (
                      <span className="badge badge-read">既読</span>
                    ) : (
                      <span className="badge badge-unread">未読</span>
                    )}
                  </td>
                  <td>
                    <OcrBadge status={d.ocr_status} />
                  </td>
                  <td>
                    <span className="badge badge-neutral">
                      {d.storage_location === "onprem" ? "オンプレ" : "クラウド"}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>
                    {new Date(d.created_at).toLocaleString("ja-JP")}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm" onClick={() => setViewerDoc(d)}>
                      閲覧
                    </button>
                    {canManage(d) && (
                      <>
                        <button className="btn btn-sm" onClick={() => setEditDoc(d)}>
                          編集
                        </button>
                        <button className="btn btn-sm" onClick={() => setVersionsDoc(d)}>
                          履歴
                        </button>
                        <button className="btn btn-sm" onClick={() => setReadsDoc(d)}>
                          既読者
                        </button>
                        <button className="btn btn-sm" onClick={() => setAclDoc(d)}>
                          権限設定
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aclDoc && <PermissionsModal doc={aclDoc} onClose={() => setAclDoc(null)} />}
      {readsDoc && <ReadReceiptsModal doc={readsDoc} onClose={() => setReadsDoc(null)} />}
      {viewerDoc && <ViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
      {editDoc && (
        <EditDocModal
          doc={editDoc}
          onClose={() => setEditDoc(null)}
          onSaved={() => {
            setEditDoc(null);
            reload();
          }}
        />
      )}
      {versionsDoc && <VersionsModal doc={versionsDoc} onClose={() => setVersionsDoc(null)} />}
    </section>
  );
}

// メタデータ/タグ/OCRテキスト編集 (F-16/F-17)
function EditDocModal({
  doc,
  onClose,
  onSaved,
}: {
  doc: DocumentRead;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category ?? "");
  const [docType, setDocType] = useState(doc.document_type ?? "");
  const [sensitivity, setSensitivity] = useState(doc.sensitivity);
  const [tagsText, setTagsText] = useState((doc.tags ?? []).join(", "));
  const [ocrText, setOcrText] = useState<string>("");
  const [ocrLoaded, setOcrLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OCRテキストは詳細取得で読み込む（一覧には含めていないため）
  useEffect(() => {
    api
      .get(`/documents/${doc.id}`)
      .then((r) => setOcrText((r.data as any).ocr_text ?? ""))
      .catch(() => {})
      .finally(() => setOcrLoaded(true));
  }, [doc.id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateDocument(doc.id, {
        title: title.trim() || doc.title,
        category: category.trim() || null,
        document_type: docType.trim() || null,
        sensitivity,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        ocr_text: ocrLoaded ? ocrText : undefined,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "保存に失敗しました（編集権限が必要です）。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <h2>ドキュメントを編集</h2>
        {error && <div className="login-error">{error}</div>}
        <label className="field">
          <span>タイトル</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>カテゴリ</span>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label className="field">
            <span>書類種別</span>
            <input className="input" value={docType} onChange={(e) => setDocType(e.target.value)} />
          </label>
          <label className="field">
            <span>機密度</span>
            <select className="select" value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
              <option value="public">公開</option>
              <option value="internal">社内</option>
              <option value="confidential">機密（オンプレ保存）</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>タグ（カンマ区切り）</span>
          <input className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="契約, 2026年度, 経理" />
        </label>
        <label className="field">
          <span>OCRテキスト（手動修正）</span>
          <textarea
            className="input"
            rows={8}
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            placeholder={ocrLoaded ? "" : "読み込み中…"}
            style={{ fontFamily: "monospace", resize: "vertical" }}
          />
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>キャンセル</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存して再索引"}
          </button>
        </div>
      </div>
    </div>
  );
}

// バージョン履歴 (F-19)
function VersionsModal({ doc, onClose }: { doc: DocumentRead; onClose: () => void }) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVersions(doc.id)
      .then(setVersions)
      .catch(() => setError("履歴の取得に失敗しました。"))
      .finally(() => setLoading(false));
  }, [doc.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>バージョン履歴</h2>
        <p style={{ color: "var(--text-muted)", marginTop: -4 }}>
          {doc.title}（現在 v{doc.version}）
        </p>
        {error && <div className="login-error">{error}</div>}
        {loading ? (
          <div className="state"><div className="spinner" /></div>
        ) : versions.length === 0 ? (
          <p style={{ color: "var(--text-subtle)" }}>
            差し替え履歴はありません。モバイル/APIから再アップロードすると履歴が残ります。
          </p>
        ) : (
          <div className="acl-list">
            {versions.map((v) => (
              <div className="acl-row" key={v.id}>
                <div className="acl-user">
                  <strong>v{v.version}</strong>
                  <span>{v.page_count}ページ・{v.file_format}{v.note ? `・${v.note}` : ""}</span>
                </div>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {new Date(v.created_at).toLocaleString("ja-JP")}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// 既読者一覧（誰がいつ読んだか, F-32）
function ReadReceiptsModal({ doc, onClose }: { doc: DocumentRead; onClose: () => void }) {
  const [reads, setReads] = useState<ReadReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReadReceipts(doc.id)
      .then(setReads)
      .catch(() => setError("既読者の取得に失敗しました（管理者または所有者のみ）。"))
      .finally(() => setLoading(false));
  }, [doc.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>既読者</h2>
        <p style={{ color: "var(--text-muted)", marginTop: -4 }}>{doc.title}</p>
        {error && <div className="login-error">{error}</div>}
        {loading ? (
          <div className="state">
            <div className="spinner" />
          </div>
        ) : reads.length === 0 ? (
          <p style={{ color: "var(--text-subtle)" }}>まだ誰も閲覧していません。</p>
        ) : (
          <div className="acl-list">
            {reads.map((r) => (
              <div className="acl-row" key={r.user_id}>
                <div className="acl-user">
                  <strong>{r.user_name}</strong>
                  <span>{r.user_email}</span>
                </div>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {new Date(r.read_at).toLocaleString("ja-JP")}
                </span>
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

const LEVELS: { value: PermissionLevel | "none"; label: string }[] = [
  { value: "none", label: "権限なし" },
  { value: "view", label: "閲覧のみ" },
  { value: "edit", label: "編集可" },
  { value: "delete", label: "削除可" },
];

// ドキュメント単位ACL の設定 (F-36, F-37)
function PermissionsModal({ doc, onClose }: { doc: DocumentRead; onClose: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  // userId -> level（"none" は未付与）
  const [levels, setLevels] = useState<Record<string, PermissionLevel | "none">>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listUsers(), listPermissions(doc.id)])
      .then(([us, perms]) => {
        setUsers(us);
        const map: Record<string, PermissionLevel | "none"> = {};
        us.forEach((u) => (map[u.id] = "none"));
        perms.forEach((p) => (map[p.user_id] = p.level));
        setLevels(map);
      })
      .catch(() => setError("権限情報の取得に失敗しました（管理者または所有者のみ操作できます）。"))
      .finally(() => setLoading(false));
  }, [doc.id]);

  async function change(userId: string, next: PermissionLevel | "none") {
    const prev = levels[userId] ?? "none";
    setLevels((m) => ({ ...m, [userId]: next }));
    setSavingId(userId);
    try {
      if (next === "none") {
        await removePermission(doc.id, userId);
      } else {
        await upsertPermission(doc.id, userId, next);
      }
    } catch (e: any) {
      setLevels((m) => ({ ...m, [userId]: prev })); // ロールバック
      alert(e?.response?.data?.detail ?? "権限の更新に失敗しました。");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>権限設定</h2>
        <p style={{ color: "var(--text-muted)", marginTop: -4 }}>{doc.title}</p>
        <p style={{ color: "var(--text-subtle)", fontSize: 13 }}>
          所有者と管理者は常にフル権限です。ここでは他ユーザーのアクセスを設定します。
        </p>

        {error && <div className="login-error">{error}</div>}
        {loading ? (
          <div className="state">
            <div className="spinner" />
          </div>
        ) : (
          <div className="acl-list">
            {users
              .filter((u) => u.id !== doc.owner_id)
              .map((u) => (
                <div className="acl-row" key={u.id}>
                  <div className="acl-user">
                    <strong>{u.name}</strong>
                    <span>{u.email}</span>
                  </div>
                  <select
                    className="select"
                    value={levels[u.id] ?? "none"}
                    disabled={savingId === u.id}
                    onChange={(e) => change(u.id, e.target.value as PermissionLevel | "none")}
                  >
                    {LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            {users.filter((u) => u.id !== doc.owner_id).length === 0 && (
              <p style={{ color: "var(--text-subtle)" }}>付与できる他ユーザーがいません。</p>
            )}
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
