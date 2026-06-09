# 計画: OCR/要約の精度向上 + 検索結果から画像確認

> 実装の計画・進捗ログ。`doc/task.md` のチェック更新と併用する。

## Context（目的）
1. **OCR精度を上げる**: 傾き補正・回転・ノイズ除去・LSTMエンジン指定など ocrmypdf/tesseract の前処理を強化。
   抽出テキストの正規化（CJK間の余分な空白・改行の整理）で検索/要約の質も底上げ。
2. **要約精度を上げる**: 「先頭数文」方式から、**kuromoji 形態素解析（OpenSearch _analyze）による
   頻度ベースの抽出型要約**へ。OCRノイズ除去後に要約する。Dify 設定時は従来どおり Dify 優先。
3. **全文検索結果から画像を確認**: 検索ヒットに**サムネイル**を表示し、**クリックでページビューア**
   （ページ送り＋ズーム）を開く（Web）。モバイルは結果にサムネイル＋タップで詳細（画像表示）。

## 実装

### OCR精度（T-303/304/305 強化）
- `dockerfiles/ocr-worker.Dockerfile`: `unpaper`（ocrmypdf `clean` 用）・`tesseract-ocr-osd`（回転検出用）追加。
- `services/pdf_export.py`: ocrmypdf を `deskew / rotate_pages / clean / tesseract_oem=1(LSTM) /
  tesseract_pagesegmode=3` で実行。失敗時は素のオプションへ自動フォールバック（環境差で落ちない）。
- `services/summarize.py` に `clean_ocr_text()`: NFKC正規化・CJK間の空白除去・連続改行/空白の圧縮。
- `workers/ocr_worker.py`: 抽出テキストを正規化してから DB保存/索引/要約に渡す。

### 要約精度（T-409 強化）
- `services/summarize.py`: `_extractive_summary()` を追加。
  - kuromoji（`indices.analyze` の `ja_analyzer`）で全文を1回トークン化→トークンの出現頻度を算出。
  - 文をオフセットでバケットに割り当て、文スコア=Σtf/√(文長) で上位文を選び、原文順に連結。
  - OpenSearch 不達/失敗時は従来のルールベースへフォールバック。Dify 設定時は Dify 優先。

### 検索→画像（T-401/402/408 連携）
- Web: `components/DocViewer.tsx` に **ViewerModal / DocThumb** を共通化（DocumentsPage と SearchPage で共用）。
  `SearchPage` 各ヒットにサムネイル＋クリックで `getDocument(id)`→ViewerModal。
- Mobile: `SearchScreen` の各ヒットにサムネイル（認証付き `/content`）。タップで Detail（画像表示）。

## 検証
- worker 再ビルド（unpaper/osd）。アップロード→OCRテキスト/要約の質を確認。
- Web `tsc`+`build`、モバイル `tsc`。検索→サムネイル→ビューアの動作。

## 留意点
- OCR強化オプションは環境により未対応の可能性があるため**フォールバック必須**。
- 抽出型要約は教師なしのベストエフォート（Dify 利用時はそちらが高品質）。

## 進捗ログ
- (着手) 計画を doc/ に出力。
- OCR精度: `ocr-worker.Dockerfile` に `tesseract-ocr-osd`/`unpaper` 追加。`pdf_export._run_ocr` で
  deskew/rotate_pages/clean/tesseract_oem=1/pagesegmode=3 を適用し、失敗時は素のオプションへ自動フォールバック。
  `summarize.clean_ocr_text`（NFKC＋CJK間空白除去＋空白/改行圧縮）を worker で抽出直後に適用。
- 要約精度: `summarize._extractive_summary` を追加（kuromoji `indices.analyze` で全文を1回トークン化→
  語頻度→文スコア=Σtf/√文長→上位文を原文順に連結）。Dify>抽出>ルールベースの優先順。
- 検索→画像: Web `components/DocViewer.tsx`（DocThumb/ViewerModal）を共通化し DocumentsPage と SearchPage で共用。
  SearchPage の各ヒットにサムネイル＋クリックでビューア（page_count は getDocument で補完）。サムネイルタブのカードもクリックでビューア。
  Mobile `SearchScreen` の各ヒットにサムネイル（認証付き /content）、タップで Detail。
- 検証:
  - worker 再ビルド後 `unpaper`/`osd`/`jpn_vert` 在席を確認。アップロード→**強化OCRがフォールバックせず成功**（done、ログにfailedなし）。
  - 要約器を実 Japanese 文(7文)で実行→**頻度スコアで7文中5文を抽出**（配当/社外秘の低情報文を除外）し原文順に連結。
  - `clean_ocr_text` が「当社 の 売上 高」→「当社の売上高」に整形することを確認。
  - Web `tsc`＋`vite build` 成功、モバイル `tsc` 成功。
- 留意: 強化OCR/抽出要約は**ベストエフォート**。実機の日本語写真での品質は端末・照明に依存。
  品質の定量比較は実文書サンプルが必要（合成テスト画像では効果を可視化しきれない）。
