import { useEffect, useState } from "react";
import {
  apiErrorMessage,
  getDocument,
  listDocuments,
  listUsers,
  listPermissions,
  upsertPermission,
  removePermission,
  updateDocument,
  updateInsight,
  listVersions,
  isAdminRole,
  IMPORTANCE_LABEL,
  type DocumentRead,
  type DocumentVersion,
  type Importance,
  type User,
  type PermissionLevel,
} from "../api/client";
import { DocThumb, ViewerModal } from "../components/DocViewer";
import { DeadlineChip, FamilyModal, ImportanceBadge } from "../components/FamilyPanel";
import { useMe } from "../me";

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

// 家に届いた紙の箱: 未読 / 重要 / 期限あり で見逃しを防ぐ（モバイルの一覧と同じ区分）
type Filter = "all" | "unread" | "important" | "deadline" | "read";
const FILTERS: { key: Filter; label: string; match: (d: DocumentRead) => boolean }[] = [
  { key: "all", label: "すべて", match: () => true },
  { key: "unread", label: "未読", match: (d) => !d.is_read },
  { key: "important", label: "🔴 重要", match: (d) => d.importance === "high" },
  { key: "deadline", label: "📅 期限あり", match: (d) => !!d.deadline },
  { key: "read", label: "既読", match: (d) => d.is_read },
];

// ドキュメント一覧 (F-21)
export function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { me } = useMe();
  const [aclDoc, setAclDoc] = useState<DocumentRead | null>(null);
  const [familyDoc, setFamilyDoc] = useState<DocumentRead | null>(null);
  const [editDoc, setEditDoc] = useState<DocumentRead | null>(null);
  const [viewerDoc, setViewerDoc] = useState<DocumentRead | null>(null);
  const [versionsDoc, setVersionsDoc] = useState<DocumentRead | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"list" | "grid">("list");

  function reload() {
    listDocuments().then(setDocs).catch(() => {});
  }

  useEffect(() => {
    listDocuments()
      .then(setDocs)
      .catch(() => setError("一覧の取得に失敗しました。バックエンドの接続状態をご確認ください。"))
      .finally(() => setLoading(false));
  }, []);

  // 権限設定・既読者の確認は（テナント）管理者または所有者のみ。サーバー側でも同じ判定をする
  const canManage = (d: DocumentRead) => isAdminRole(me?.role) || me?.id === d.owner_id;

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

  const current = FILTERS.find((f) => f.key === filter)!;
  const shown = docs.filter(current.match);
  const countOf = (f: (typeof FILTERS)[number]) => (f.key === "all" || f.key === "read" ? 0 : docs.filter(f.match).length);

  return (
    <section>
      {/* 未読/重要/期限 と リスト/サムネイル の切替タブ */}
      <div className="listbar">
        <div className="seg">
          {FILTERS.map((f) => {
            const n = countOf(f);
            return (
              <button key={f.key} className={"seg-btn" + (filter === f.key ? " active" : "")} onClick={() => setFilter(f.key)}>
                {f.label}{n ? ` (${n})` : ""}
              </button>
            );
          })}
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
            <p>モバイルアプリで紙資料を撮影・取り込みすると、ここに一覧表示されます。</p>
          </div>
        </div>
      ) : view === "grid" ? (
        <div className="thumb-grid">
          {shown.map((d) => (
            <div key={d.id} className="thumb-card" title={d.title} onClick={() => setViewerDoc(d)} style={{ cursor: "pointer" }}>
              <DocThumb id={d.id} />
              {!d.is_read && <span className="thumb-unread" />}
              {d.importance === "high" && <span className="thumb-important">🔴 重要</span>}
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
                <th>家族</th>
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
                    {(d.importance === "high" || d.deadline) && (
                      <div className="chips" style={{ marginTop: 6 }}>
                        <ImportanceBadge importance={d.importance} />
                        <DeadlineChip deadline={d.deadline} />
                      </div>
                    )}
                  </td>
                  <td>
                    {d.is_read ? (
                      <span className="badge badge-read">既読</span>
                    ) : (
                      <span className="badge badge-unread">未読</span>
                    )}
                  </td>
                  <td>
                    {d.family_total > 1 ? (
                      <span className={"family-count" + (d.family_confirmed < d.family_total ? " pending" : "")}>
                        {d.family_confirmed}/{d.family_total} 確認
                      </span>
                    ) : (
                      <span className="family-count">—</span>
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
                    <button className="btn btn-sm" onClick={() => setFamilyDoc(d)}>
                      家族・対応
                    </button>
                    {canManage(d) && (
                      <>
                        <button className="btn btn-sm" onClick={() => setEditDoc(d)}>
                          編集
                        </button>
                        <button className="btn btn-sm" onClick={() => setVersionsDoc(d)}>
                          履歴
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
      {familyDoc && (
        <FamilyModal
          doc={familyDoc}
          onClose={() => {
            setFamilyDoc(null);
            reload(); // 自分の対応・既読を一覧に反映
          }}
        />
      )}
      {viewerDoc && (
        <ViewerModal
          doc={viewerDoc}
          onClose={() => {
            setViewerDoc(null);
            reload(); // 閲覧で既読化されたバッジを反映（モバイルは画面フォーカス時に再取得）
          }}
        />
      )}
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
  // 文書解析の結果（重要度・期限・対象）。変えたときだけ手動修正として保存する
  const [importance, setImportance] = useState<Importance | "">(doc.importance ?? "");
  const [deadline, setDeadline] = useState(doc.deadline ?? "");
  const [audience, setAudience] = useState(doc.audience ?? "");
  const [ocrText, setOcrText] = useState<string>("");
  // 読み込めた元のOCRテキスト。null の間（未取得/取得失敗）は ocr_text を送らない
  const [ocrOriginal, setOcrOriginal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ocrLoaded = ocrOriginal !== null;

  // OCRテキストは詳細取得で読み込む（一覧には含めていないため）
  useEffect(() => {
    getDocument(doc.id)
      .then((d) => {
        setOcrText(d.ocr_text ?? "");
        setOcrOriginal(d.ocr_text ?? "");
      })
      .catch(() => {});
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
        // 手動修正したときだけ送る（未変更で送ると再OCR等の結果を上書きしうるため）
        ocr_text: ocrLoaded && ocrText !== ocrOriginal ? ocrText : undefined,
      });
      const insightChanged =
        (importance || null) !== doc.importance ||
        (deadline || null) !== doc.deadline ||
        (audience.trim() || null) !== doc.audience;
      if (insightChanged) {
        await updateInsight(doc.id, {
          ...(importance ? { importance } : {}),
          deadline: deadline || null,
          audience: audience.trim() || null,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(apiErrorMessage(e, "保存に失敗しました（編集権限が必要です）。"));
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
        <div className="field-row">
          <label className="field">
            <span>重要度</span>
            <select className="select" value={importance} onChange={(e) => setImportance(e.target.value as Importance)}>
              {!importance && <option value="">（解析前）</option>}
              {(Object.keys(IMPORTANCE_LABEL) as Importance[]).map((k) => (
                <option key={k} value={k}>{IMPORTANCE_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>期限</span>
            <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <label className="field">
            <span>対象</span>
            <input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="保護者 など" />
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
            差し替え履歴はありません。APIで差し替え（新バージョン登録）すると履歴が残ります。
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
      alert(apiErrorMessage(e, "権限の更新に失敗しました。"));
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
