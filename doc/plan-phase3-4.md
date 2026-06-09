# 計画: フェーズ3・フェーズ4 全実装 + 検索に要約テキストを対象追加

> 実装の計画・進捗ログ。`doc/task.md` のチェック更新と併用する。

## Context（背景・目的）
- **フェーズ3 (ドキュメント化・OCR・保存)** と **フェーズ4 (閲覧・検索)** を一通り実装する。
- **検索対象に要約テキストを追加**: OCR全文に加え、ワーカーが生成する要約(`summarize`)も
  OpenSearch に索引し、全文検索でヒットするようにする（明示要望）。
- DBスキーマは `create_all` が新規テーブルのみ作成（既存テーブルは ALTER しない）制約に従う。
  既存 `documents` には category/document_type/version/retention_until 列が既にある。
  タグ・バージョン履歴は **新規テーブル**で実装する。要約は MinIO + OpenSearch に保持（DB列追加なし）。

---

## フェーズ3: ドキュメント化・OCR・保存

- **T-302 OCRワーカー基盤(非同期)**: 既存ポーリングワーカー(pending→processing→done/failed)を堅牢化（例外時 failed・成果物保存の分離は実装済）。本タスクは現状を [x] とし注記。
- **T-303 OCRテキスト抽出**: ocrmypdf sidecar で抽出済み。[x]。
- **T-304 日本語(縦書き)・英数字混在**: `ocr_lang` を `jpn+jpn_vert+eng` に（縦書き traineddata は worker イメージに導入済 `tesseract-ocr-jpn-vert`）。[x]。
- **T-306 メタデータ付与(タグ/カテゴリ/書類種別)**: 新規 `DocumentTag` テーブル。`PATCH /documents/{id}` で
  title/category/document_type/sensitivity/tags を更新。Web に編集UI。索引も更新。[x]。
- **T-308 機密度ハイブリッドストレージ**: `storage.resolve_location(sensitivity)` で confidential→onprem、他→cloud。
  アップロード/バージョン更新時に適用済。[x]。
- **T-309 OCR結果の手動修正UI**: `PATCH /documents/{id}` で `ocr_text` を更新→再索引。Web 詳細編集にテキスト修正欄。[x]。
- **T-310 バージョン管理**: 新規 `DocumentVersion` テーブル。`POST /documents/{id}/versions` で
  現行を履歴退避→新ページ保存→version++→再OCR(pending)。`GET /documents/{id}/versions` で履歴。[x]。

## フェーズ4: 閲覧・検索

- **T-401 一覧・サムネイル**: 実装済(リスト/サムネイルタブ)。[x]。
- **T-402 ページめくり・拡大縮小ビューア**: `GET /documents/{id}/pages/{i}/content`(処理済みページ)。
  Web にページ送り＋ズームのビューアモーダル。[x]。
- **T-403 OCRテキスト索引登録**: ワーカーが索引。要約・タグも索引に追加。[x]。
- **T-404 全文検索(表記ゆれ/あいまい)**: multi_match + fuzziness(AUTO)。対象に summary 追加。[x]。
- **T-405 キーワード検索(タイトル・タグ・メタデータ)**: title/tags/category を索引・検索対象に。[x]。
- **T-407 権限に応じたDL/印刷**: DL系は view 権限を強制(実装済)。`POST /documents/{id}/print-log` で印刷操作ログ。[x]。
- **T-408 ハイライト・該当箇所**: 検索結果に ocr_text/summary のハイライト断片を返却・表示。[x]。
- **T-409 要約PDF出力**: 実装済。要約をワーカーで生成・保存し検索とPDFで再利用。[x]。

---

## 実装詳細

### Backend
- `core/config.py`: `ocr_lang = "jpn+jpn_vert+eng"`。
- `models/document_tag.py`(新): DocumentTag(document_id, tag, uq)。
- `models/document_version.py`(新): DocumentVersion(document_id, version, storage_key, page_count, file_format, ocr_text, note, created_by, created_at)。
- `main.py`: 新モデル import。
- `schemas/document.py`: DocumentRead に `tags: list[str]`、`DocumentUpdate`、`VersionRead`、SearchHit に category/tags/matched_in。
- `services/search.py`: mapping に summary(text/ja) と tags(keyword+text)。既存indexには put_mapping で追加(冪等)。
  search() の fields に summary・tags を追加、highlight を ocr_text+summary。tag/category フィルタ。
- `workers/ocr_worker.py`: OCR後に `summarize.summarize(text)` を生成し `{id}/summary.txt` 保存、索引 body に summary・tags 追加。
- `api/routes/documents.py`:
  - 一覧/取得で tags を付与（バッチ取得）。
  - `PATCH /documents/{id}`(edit権限): メタデータ/タグ/ocr_text 更新→DB→tags置換→再索引→AccessLog(edit)。
  - `GET /documents/{id}/pages/{i}/content`(view): 処理済みページ proc/{i} を返す(無ければ生ページ)。
  - `POST /documents/{id}/versions`(edit): 履歴退避→新ページ保存→version++→pending 再処理。
  - `GET /documents/{id}/versions`(view): 履歴一覧。
  - `POST /documents/{id}/print-log`(view): AccessLog(print)。

### Web
- `api/client.ts`: DocumentRead に tags、updateDocument/listVersions/createVersion/printLog、SearchHit 拡張。
- `pages/DocumentsPage.tsx`: 行に「編集」(メタ/タグ/OCR修正モーダル)・「閲覧」(ページビューア)・「履歴」。
- `pages/SearchPage.tsx`: 要約も検索対象である旨・タグ/カテゴリ表示・ハイライト。
- ビューア: `/pages/{i}/content` をページ送り＋ズーム表示。

### Mobile
- `screens/SearchScreen.tsx`(新): /search を呼び結果一覧→詳細。App.tsx にナビ追加、一覧にヘッダ導線。
- 詳細にメタデータ/タグ表示。

---

## 検証
1. backend 再ビルド(新モデル=新規テーブル, search mapping 追加)。
2. curl: アップロード→ワーカーが summary.txt 生成・索引、`/search?q=要約語` でヒット、ハイライト確認。
   PATCH でタグ/カテゴリ/OCR修正→再索引→タグ検索ヒット。versions 履歴、pages/{i} 取得、print-log。
3. Web `vite build`、モバイル `tsc`。

## 留意点
- 要約は Dify 未設定時ルールベース。検索対象としては OCR本文の補助。
- バージョン管理は基本実装（履歴メタ＋成果物キー退避）。差分マージ等は対象外。
- 既存 index には put_mapping で summary/tags を後付け（再作成不要）。

## 進捗ログ
- (着手) 計画を doc/ に出力。
- バックエンド完了:
  - `config.ocr_lang = jpn+jpn_vert+eng`（縦書き対応, T-304）。
  - 新規テーブル `DocumentTag`/`DocumentVersion`（create_all で自動作成、既存テーブルは無改変）。
  - `services/search.py`: mapping に summary/tags 追加（既存indexは put_mapping で後付け・冪等）。
    検索フィールドを title/tags/ocr_text/**summary** に拡張、ハイライト＋一致箇所(matched_in)返却、tag完全一致フィルタ。
  - `workers/ocr_worker.py`: OCR後に `summarize` で要約生成→`{id}/summary.txt` 保存＋索引(summary/tags)。
  - `api/routes/documents.py`: 一覧/取得に tags 付与、`PATCH`(メタ/タグ/OCR修正→再索引)、
    `GET /pages/{i}/content`(ビューア)、`POST/GET /versions`(履歴)、`POST /print-log`。
- Web完了: client 拡張、`DocumentsPage` に 閲覧(ページ送り＋ズーム＋印刷)/編集(メタ・タグ・OCR修正)/履歴、
  一覧にタグ・カテゴリchip、`SearchPage` に一致箇所/カテゴリ/タグ表示・要約も対象の旨。index.css 追加。
- モバイル完了: `SearchScreen`(全文検索→詳細)、App.tsx ナビ＋一覧ヘッダに検索導線、client に searchDocuments。
- 検証(backend 再起動→curl): 新テーブル作成OK、索引 mapping に summary/tags 反映。
  PATCH でタグ/カテゴリ/書類種別/OCRテキスト更新→再索引。OCR修正語 `請求金額` 検索でハイライト一致。
  **タグ専用語（OCR本文に無い語）検索でヒット→タグが検索対象であることを実証**。tagフィルタ動作。
  新規アップロード→ワーカーが要約生成（summary_len>0）し索引へ反映→**要約が検索対象**であることを確認。
  `/pages/0/content`=200画像、`/versions`=履歴、`/print-log`=204。差し替えで version++＆履歴記録→再OCRでdone。
- ビルド: Web `tsc`＋`vite build` 成功、モバイル `tsc` 成功。
- 留意: 要約は OCR本文の部分集合（独立語での切り分け不可）だが、索引フィールド・検索クエリ・ハイライトに
  summary を含め、タグ専用語ヒットで非OCRフィールドの検索が機能することを実証済み。
  バージョン管理は履歴メタ＋成果物キー退避までの基本実装（差分マージ等は対象外）。
