import type { DocumentRead } from "./api/client";

// 検索欄に入力している間の絞り込み（ブラウザ内だけで行い、サーバーには送らない。モバイルと同じ）。
// 一覧 API で取った書類のタイトル・タグ・カテゴリ・書類の種類を見る。本文・ひらがなの読み・
// OCR の読み違いは、確定（Enter / 検索）したときの全文検索で探す。

export type LocalField = "title" | "tags" | "category" | "document_type";

export const LOCAL_FIELD_LABEL: Record<LocalField, string> = {
  title: "タイトル",
  tags: "タグ",
  category: "カテゴリ",
  document_type: "書類の種類",
};

// 全角/半角・大文字/小文字・カタカナ/ひらがなの違いを吸収する（「ﾁﾗｼ」「ちらし」で「チラシ」に当てる）
export function normalizeForMatch(s: string): string {
  const nfkc = typeof s.normalize === "function" ? s.normalize("NFKC") : s;
  return nfkc
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export interface LocalEntry {
  doc: DocumentRead;
  fields: [LocalField, string][]; // 正規化済み
}

// 一覧を取り直したときに1回だけ作る（入力のたびに正規化し直さない）
export function buildLocalIndex(docs: DocumentRead[]): LocalEntry[] {
  return docs.map((doc) => ({
    doc,
    fields: [
      ["title", normalizeForMatch(doc.title)],
      ["tags", normalizeForMatch((doc.tags ?? []).join(" "))],
      ["category", normalizeForMatch(doc.category ?? "")],
      ["document_type", normalizeForMatch(doc.document_type ?? "")],
    ],
  }));
}

export interface LocalHit {
  doc: DocumentRead;
  matchedIn: LocalField;
}

// 空白で区切った語をすべて含む書類（語ごとに別の項目でもよい）。タイトルに当たったものを先に、
// その中は一覧の順（新しい順）のまま
export function filterLocally(index: LocalEntry[], query: string): LocalHit[] {
  const terms = normalizeForMatch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const inTitle: LocalHit[] = [];
  const others: LocalHit[] = [];
  for (const { doc, fields } of index) {
    if (!terms.every((t) => fields.some(([, text]) => text.includes(t)))) continue;
    const matchedIn = fields.find(([, text]) => terms.some((t) => text.includes(t)))![0];
    (matchedIn === "title" ? inTitle : others).push({ doc, matchedIn });
  }
  return [...inTitle, ...others];
}
