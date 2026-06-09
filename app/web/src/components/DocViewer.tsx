import { useEffect, useState } from "react";
import { api, getDocument, logPrint, downloadOcrTextPdf } from "../api/client";

// 認証付きで /content（処理済みプレビュー）を取得し objectURL で表示するサムネイル
export function DocThumb({ id, className }: { id: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    api
      .get(`/documents/${id}/content`, { responseType: "blob" })
      .then((r) => {
        const u = URL.createObjectURL(r.data as Blob);
        revoke = u;
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [id]);
  return url ? (
    <img className={className ?? "thumb-img"} src={url} alt="" />
  ) : (
    <div className={`${className ?? "thumb-img"} thumb-ph`} />
  );
}

// ページめくり・拡大縮小ビューア (F-22)。page_count 未指定なら自動取得する。
export function ViewerModal({
  doc,
  onClose,
}: {
  doc: { id: string; title: string; page_count?: number };
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [total, setTotal] = useState(Math.max(doc.page_count ?? 1, 1));
  const [ocrBusy, setOcrBusy] = useState(false);

  async function onOcrPdf() {
    setOcrBusy(true);
    try {
      await downloadOcrTextPdf(doc.id, doc.title);
    } catch {
      alert("OCRテキストPDFを出力できませんでした（OCR完了後に利用できます）。");
    } finally {
      setOcrBusy(false);
    }
  }

  // page_count が無い（検索結果など）場合は詳細取得で総ページ数を補う
  useEffect(() => {
    if (doc.page_count == null) {
      getDocument(doc.id)
        .then((d) => setTotal(Math.max(d.page_count, 1)))
        .catch(() => {});
    }
  }, [doc.id, doc.page_count]);

  useEffect(() => {
    let revoke: string | null = null;
    setUrl(null);
    api
      .get(`/documents/${doc.id}/pages/${page}/content`, { responseType: "blob" })
      .then((r) => {
        const u = URL.createObjectURL(r.data as Blob);
        revoke = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [doc.id, page]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <h2 style={{ margin: 0 }}>{doc.title}</h2>
          <div className="viewer-tools">
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>－</button>
            <span style={{ minWidth: 48, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>＋</button>
            <button className="btn btn-sm" onClick={onOcrPdf} disabled={ocrBusy}>
              {ocrBusy ? "出力中…" : "📄 OCRテキストPDF"}
            </button>
            <button className="btn btn-sm" onClick={() => { logPrint(doc.id); window.print(); }}>🖨 印刷</button>
          </div>
        </div>
        <div className="viewer-stage">
          {url ? (
            <img className="viewer-img" src={url} alt="" style={{ transform: `scale(${zoom})` }} />
          ) : (
            <div className="state"><div className="spinner" /></div>
          )}
        </div>
        <div className="viewer-nav">
          <button className="btn btn-sm" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>‹ 前へ</button>
          <span>{page + 1} / {total}</span>
          <button className="btn btn-sm" disabled={page >= total - 1} onClick={() => setPage((p) => p + 1)}>次へ ›</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
