import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import {
  IoAdd,
  IoChevronBack,
  IoChevronForward,
  IoDocumentOutline,
  IoDocumentTextOutline,
  IoPrintOutline,
  IoReaderOutline,
  IoRemove,
  IoSparklesOutline,
} from "react-icons/io5";
import { api, getDocument, logPrint, downloadPdf, type PdfKind } from "../api/client";

// 認証付きで画像を取得し objectURL にする（アンマウント/切替時に revoke）
function useAuthedObjectUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    setUrl(null);
    api
      .get(path, { responseType: "blob" })
      .then((r) => {
        const u = URL.createObjectURL(r.data as Blob);
        revoke = u;
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]);
  return url;
}

// /content（処理済みプレビュー）のサムネイル
export function DocThumb({ id, className }: { id: string; className?: string }) {
  const url = useAuthedObjectUrl(`/documents/${id}/content`);
  return url ? (
    <img className={className ?? "thumb-img"} src={url} alt="" />
  ) : (
    // 読み込み前・取得できないときは書類アイコン（モバイルと同じ）
    <div className={`${className ?? "thumb-img"} thumb-ph`}>
      <IoDocumentOutline />
    </div>
  );
}

// PDF出力ボタン（モバイル詳細画面と同じ3種・同じ文言・同じアイコン）
const PDF_BUTTONS: { kind: PdfKind; label: string; icon: IconType; notReadyMsg: string }[] = [
  {
    kind: "document",
    label: "電子資料PDF",
    icon: IoDocumentTextOutline,
    notReadyMsg: "電子資料PDFはまだ生成されていません（OCR処理の完了後に自動生成されます）。",
  },
  {
    kind: "ocr",
    label: "OCRテキストPDF",
    icon: IoReaderOutline,
    notReadyMsg: "OCRがまだ完了していません。少し待って再度お試しください。",
  },
  {
    kind: "summary",
    label: "要約PDF",
    icon: IoSparklesOutline,
    notReadyMsg: "OCRがまだ完了していません。少し待って再度お試しください。",
  },
];

// ページめくり・拡大縮小ビューア (F-22)。
// 開いた時点で詳細を取得し、閲覧ログ記録・既読化を行う（モバイル詳細画面と同じ, F-28/F-32）。
export function ViewerModal({
  doc,
  onClose,
}: {
  doc: { id: string; title: string; page_count?: number };
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [total, setTotal] = useState(Math.max(doc.page_count ?? 1, 1));
  const [pdfBusy, setPdfBusy] = useState<PdfKind | null>(null);
  const url = useAuthedObjectUrl(`/documents/${doc.id}/pages/${page}/content`);

  useEffect(() => {
    getDocument(doc.id)
      .then((d) => setTotal(Math.max(d.page_count, 1)))
      .catch(() => {});
  }, [doc.id]);

  async function onPdf(b: (typeof PDF_BUTTONS)[number]) {
    setPdfBusy(b.kind);
    try {
      await downloadPdf(doc.id, b.kind, doc.title);
    } catch (e: any) {
      const status = e?.response?.status;
      alert(status === 404 || status === 409 ? b.notReadyMsg : "PDFの出力に失敗しました。");
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <h2 style={{ margin: 0 }}>{doc.title}</h2>
          <div className="viewer-tools">
            <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} title="縮小" aria-label="縮小">
              <IoRemove />
            </button>
            <span style={{ minWidth: 48, textAlign: "center", fontSize: 13 }}>{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} title="拡大" aria-label="拡大">
              <IoAdd />
            </button>
            {PDF_BUTTONS.map((b) => {
              const Icon = b.icon;
              return (
                <button key={b.kind} className="btn btn-sm" onClick={() => onPdf(b)} disabled={pdfBusy !== null}>
                  <Icon />
                  {pdfBusy === b.kind ? "出力中…" : b.label}
                </button>
              );
            })}
            <button className="btn btn-sm" onClick={() => { logPrint(doc.id); window.print(); }}>
              <IoPrintOutline />
              印刷
            </button>
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
          <div className="pager">
            <button className="icon-btn" disabled={page <= 0} onClick={() => setPage((p) => p - 1)} title="前のページ" aria-label="前のページ">
              <IoChevronBack />
            </button>
            <span>{page + 1} / {total}</span>
            <button className="icon-btn" disabled={page >= total - 1} onClick={() => setPage((p) => p + 1)} title="次のページ" aria-label="次のページ">
              <IoChevronForward />
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
