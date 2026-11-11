import { useEffect, useMemo, useRef, useState } from "react";
import { IoAlertCircleOutline, IoDocumentOutline, IoDocumentTextOutline, IoSearch, IoSearchOutline } from "react-icons/io5";
import { listDocuments, searchDocuments, type DocumentRead, type SearchHit } from "../api/client";
import { CategoryIcon } from "../categoryStyle";
import { DocThumb, ViewerModal } from "../components/DocViewer";
import { buildLocalIndex, filterLocally, LOCAL_FIELD_LABEL } from "../localSearch";

const MATCH_LABEL: Record<string, string> = {
  ocr_text: "本文",
  title: "タイトル",
};

// OpenSearch のハイライト(<em>)だけを強調表示し、それ以外は文字列として描画する。
// 本文はOCR/手動修正由来で HTML エスケープされていないため innerHTML には渡さない。
function Highlighted({ snippet }: { snippet: string }) {
  return (
    <>
      {snippet.split(/<\/?em>/).map((part, i) => (i % 2 === 1 ? <em key={i}>{part}</em> : part))}
    </>
  );
}

// 検索 (F-23〜F-25)。サーバーの負荷を抑えるため2段にする（モバイルと同じ）:
// - 入力中: ページを開いたときに取った一覧を、ブラウザ内でタイトル・タグ・カテゴリ・書類の種類から絞り込む（通信なし）
// - 確定（Enter /「検索」）: 全文検索を1回。OCR 本文・ひらがなの読み・OCR の読み違いでも当たる
// 入力中の候補は、サムネイルの代わりにカテゴリのアイコンを出す（サムネイルは1件ごとに画像を取りに行くため）
export function SearchPage() {
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<DocumentRead[]>([]);
  // 確定した全文検索の結果。入力欄を打ち直すと（検索語が変わると）入力中の絞り込みに戻る
  const [full, setFull] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ id: string; title: string } | null>(null);
  // 最後に送った全文検索の番号（遅れて届いた古い結果で上書きしない）
  const latest = useRef(0);

  useEffect(() => {
    listDocuments().then(setDocs).catch(() => {});
  }, []);

  const index = useMemo(() => buildLocalIndex(docs), [docs]);
  const query = q.trim();
  // 表示中の全文検索の結果（入力欄の語と同じときだけ）
  const shown = full && full.query === query ? full : null;
  const local = useMemo(() => (query && !shown ? filterLocally(index, query) : []), [index, query, shown]);

  async function runFullSearch() {
    if (!query) return;
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const hits = await searchDocuments(query);
      if (id === latest.current) setFull({ query, hits });
    } catch {
      if (id === latest.current) setError("検索に失敗しました。検索エンジンの接続状態をご確認ください。");
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    runFullSearch();
  }

  const open = (d: { id: string; title: string }) => setViewer({ id: d.id, title: d.title });

  return (
    <section>
      {/* アイコン入りの検索欄（モバイルと同じ）。入力中はブラウザ内で絞り込み、Enter で本文まで検索 */}
      <form onSubmit={onSubmit} className="search-bar">
        <label className="search-field">
          <IoSearch />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setError(null);
            }}
            placeholder="本文・タイトル・タグから探す"
            aria-label="検索キーワード"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "検索中…" : "検索"}
        </button>
      </form>

      {loading && (
        <div className="state">
          <div className="spinner" />
          <p>検索中…</p>
        </div>
      )}

      {!loading && error && (
        <div className="state error">
          <IoAlertCircleOutline className="state-icon" />
          <h3>検索に失敗しました</h3>
          <p>{error}</p>
        </div>
      )}

      {/* 確定した全文検索の結果 */}
      {!loading && !error && shown && shown.hits.length === 0 && (
        <div className="state">
          <IoDocumentOutline className="state-icon" />
          <h3>一致する結果がありません</h3>
          <p>別のキーワードでお試しください。</p>
        </div>
      )}

      {!loading && !error && shown && shown.hits.length > 0 && (
        <>
          <p className="search-note">本文も含めた検索結果（{shown.hits.length}件）</p>
          <ul className="result-list">
            {shown.hits.map((h) => (
              <li key={h.id} className="result-item result-item-row">
                <button className="result-thumb" onClick={() => open(h)} title="画像を表示">
                  <DocThumb id={h.id} className="result-thumb-img" />
                </button>
                <div className="result-body">
                  <div className="result-head">
                    <h3>
                      <button className="link-btn" onClick={() => open(h)}>
                        {h.title}
                      </button>
                    </h3>
                    <span className="score">関連度 {h.score.toFixed(2)}</span>
                  </div>
                  <div className="result-meta">
                    {h.matched_in && (
                      <span className="chip chip-match">{MATCH_LABEL[h.matched_in] ?? h.matched_in}に一致</span>
                    )}
                    {h.category && <span className="chip chip-cat">{h.category}</span>}
                    {h.tags?.map((t) => (
                      <span key={t} className="chip">#{t}</span>
                    ))}
                  </div>
                  {h.snippet && (
                    <p className="snippet">
                      <Highlighted snippet={h.snippet} />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 入力中の絞り込み（ブラウザ内） */}
      {!loading && !error && !shown && query && (
        <>
          <div className="search-note search-note-row">
            <span>タイトル・タグ・カテゴリで絞り込み中（{local.length}件）</span>
            <button type="button" className="btn btn-sm search-full-btn" onClick={runFullSearch}>
              <IoDocumentTextOutline />「{query}」を本文からも探す
            </button>
          </div>
          {local.length === 0 ? (
            <div className="state">
              <IoDocumentOutline className="state-icon" />
              <h3>タイトル・タグ・カテゴリには見つかりません</h3>
              <p>Enter か「検索」で、本文やひらがな（読み）からも探せます。</p>
            </div>
          ) : (
            <ul className="result-list">
              {local.map(({ doc, matchedIn }) => (
                <li key={doc.id} className="result-item result-item-row">
                  <button className="result-thumb result-thumb-icon" onClick={() => open(doc)} title="画像を表示">
                    <CategoryIcon icon={doc.category_icon} color={doc.category_color} size={36} />
                  </button>
                  <div className="result-body">
                    <div className="result-head">
                      <h3>
                        <button className="link-btn" onClick={() => open(doc)}>
                          {doc.title}
                        </button>
                      </h3>
                    </div>
                    <div className="result-meta">
                      <span className="chip chip-match">{LOCAL_FIELD_LABEL[matchedIn]}に一致</span>
                      <span className="chip chip-cat">{doc.category ?? "未分類"}</span>
                      {doc.document_type && <span className="chip">{doc.document_type}</span>}
                      {doc.tags?.map((t) => (
                        <span key={t} className="chip">#{t}</span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!loading && !error && !query && (
        <div className="state">
          <IoSearchOutline className="state-icon" />
          <h3>キーワードで検索</h3>
          <p>
            入力するとタイトル・タグ・カテゴリから絞り込みます。Enter か「検索」で、OCR本文まで横断して探します（表記ゆれ・OCRの読み違い・ひらがなの読みにも対応）。
          </p>
        </div>
      )}

      {viewer && <ViewerModal doc={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}
