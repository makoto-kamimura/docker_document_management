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
import {
  IoAlertCircleOutline,
  IoChevronForward,
  IoCreateOutline,
  IoFileTrayOutline,
  IoGridOutline,
  IoListOutline,
  IoLockClosedOutline,
  IoPeopleOutline,
  IoTimeOutline,
} from "react-icons/io5";
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
  { key: "important", label: "重要", match: (d) => d.importance === "high" },
  { key: "deadline", label: "期限あり", match: (d) => !!d.deadline },
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
        <IoAlertCircleOutline className="state-icon" />
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
      {/* 未読/重要/期限 のフィルタ と リスト/サムネイル の切替（モバイルと同じ） */}
      <div className="listbar">
        <div className="filter-chips">
          {FILTERS.map((f) => {
            const n = countOf(f);
            return (
              <button
                key={f.key}
                className={"filter-chip" + (filter === f.key ? " active" : "")}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {n > 0 && <span className="filter-count">{n}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="icon-btn"
          onClick={() => setView(view === "list" ? "grid" : "list")}
          title={view === "list" ? "サムネイル表示" : "リスト表示"}
          aria-label={view === "list" ? "サムネイル表示" : "リスト表示"}
        >
          {view === "list" ? <IoGridOutline /> : <IoListOutline />}
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="card">
          <div className="state">
            <IoFileTrayOutline className="state-icon" />
            <h3>ドキュメントがありません</h3>
            <p>モバイルアプリで紙資料を撮影・取り込みすると、ここに一覧表示されます。</p>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="state">
          <IoFileTrayOutline className="state-icon" />
          <p>該当する紙がありません。</p>
        </div>
      ) : view === "grid" ? (
        <div className="thumb-grid">
          {shown.map((d) => (
            <div key={d.id} className="thumb-card" title={d.title} onClick={() => setViewerDoc(d)}>
              <DocThumb id={d.id} />
              {!d.is_read && <span className="thumb-unread" />}
              {d.importance === "high" && (
                <span className="thumb-important">
                  <ImportanceBadge importance={d.importance} />
                </span>
              )}
              <div className={"thumb-cap" + (d.is_read ? "" : " unread")}>{d.title}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="doc-rows">
          {shown.map((d) => (
            // 行をクリックするとビューア。右のボタンは家族・対応と（管理者・所有者のみ）編集・履歴・権限
            <div key={d.id} className={"doc-row" + (d.is_read ? "" : " unread")} onClick={() => setViewerDoc(d)}>
              <div className="doc-row-thumb">
                <DocThumb id={d.id} />
                {!d.is_read && <span className="doc-row-unread" />}
              </div>
              <div className="doc-row-body">
                <div className="doc-row-title">{d.title}</div>
                {(d.category || d.tags?.length > 0 || d.importance === "high" || d.deadline) && (
                  <div className="chips doc-row-chips">
                    <ImportanceBadge importance={d.importance} />
                    <DeadlineChip deadline={d.deadline} />
                    {d.category && <span className="chip chip-cat">{d.category}</span>}
                    {d.tags?.map((t) => (
                      <span key={t} className="chip">#{t}</span>
                    ))}
                  </div>
                )}
                <div className="doc-row-meta">
                  {d.family_total > 1 && (
                    <span className={"family-count" + (d.family_confirmed < d.family_total ? " pending" : "")}>
                      家族 {d.family_confirmed}/{d.family_total} 確認
                    </span>
                  )}
                  {d.ocr_status !== "done" && <OcrBadge status={d.ocr_status} />}
                  <span>{d.storage_location === "onprem" ? "オンプレ" : "クラウド"}</span>
                  <span>{new Date(d.created_at).toLocaleString("ja-JP")}</span>
                </div>
              </div>
              <div className="doc-row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" onClick={() => setFamilyDoc(d)} title="家族・対応" aria-label="家族・対応">
                  <IoPeopleOutline />
                </button>
                {canManage(d) && (
                  <>
                    <button className="icon-btn" onClick={() => setEditDoc(d)} title="編集" aria-label="編集">
                      <IoCreateOutline />
                    </button>
                    <button className="icon-btn" onClick={() => setVersionsDoc(d)} title="履歴" aria-label="履歴">
                      <IoTimeOutline />
                    </button>
                    <button className="icon-btn" onClick={() => setAclDoc(d)} title="権限設定" aria-label="権限設定">
                      <IoLockClosedOutline />
                    </button>
                  </>
                )}
              </div>
              <IoChevronForward className="doc-row-chevron" />
            </div>
          ))}
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
