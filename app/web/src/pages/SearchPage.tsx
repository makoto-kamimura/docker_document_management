import { useState } from "react";
import { searchDocuments, type SearchHit } from "../api/client";
import { DocThumb, ViewerModal } from "../components/DocViewer";

const MATCH_LABEL: Record<string, string> = {
  ocr_text: "本文",
  summary: "要約",
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

// 全文検索 (F-23〜F-25)
export function SearchPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ id: string; title: string } | null>(null);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      setHits(await searchDocuments(query));
      setSearched(true);
    } catch {
      setError("検索に失敗しました。検索エンジンの接続状態をご確認ください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <form onSubmit={onSearch} className="search-bar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="キーワードを入力（タイトル・OCR本文・要約・タグを横断）"
          className="input"
        />
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
          <div className="emoji">⚠️</div>
          <h3>検索に失敗しました</h3>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && searched && hits.length === 0 && (
        <div className="state">
          <div className="emoji">🔍</div>
          <h3>一致する結果がありません</h3>
          <p>別のキーワードでお試しください。</p>
        </div>
      )}

      {!loading && !error && !searched && (
        <div className="state">
          <div className="emoji">🔍</div>
          <h3>キーワードで検索</h3>
          <p>タイトル・OCR本文・<strong>要約テキスト</strong>・タグを対象に、登録済みドキュメントを横断検索します（表記ゆれ・あいまい一致対応）。</p>
        </div>
      )}

      {!loading && hits.length > 0 && (
        <ul className="result-list">
          {hits.map((h) => (
            <li key={h.id} className="result-item result-item-row">
              <button
                className="result-thumb"
                onClick={() => setViewer({ id: h.id, title: h.title })}
                title="画像を表示"
              >
                <DocThumb id={h.id} className="result-thumb-img" />
              </button>
              <div className="result-body">
                <div className="result-head">
                  <h3>
                    <button className="link-btn" onClick={() => setViewer({ id: h.id, title: h.title })}>
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
      )}

      {viewer && <ViewerModal doc={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}
