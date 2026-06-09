# 計画: 撮影画像のプレビュー + 要約PDF出力

> このファイルは実装の計画・進捗ログ。`doc/task.md` のチェック更新と併用する。

## Context（背景・目的）
実機テストで撮影→アップロード→OCRまで動くようになったが、モバイルからは
一覧でステータスが見えるだけで **撮影画像そのものを確認できない**。また、OCR済み
テキストを活用した **要約付きの電子資料PDF** の出力もまだ無い。本変更で次を実現する:

1. ドキュメント一覧の行をタップ → 詳細画面で **撮影画像をプレビュー**。
2. 詳細画面から **要約PDFを生成し、共有シートで保存/送信**。

要約は **Dify**（env設定）で生成し、未設定時は**ルールベース簡易要約にフォールバック**。
PDF本文は要約のみ（識別用にタイトル見出しのみ付与）。出力は expo-sharing の共有シート。

---

## バックエンド

### 1. 設定追加 — `app/backend/app/core/config.py`
`Settings` に Dify 用フィールドを追加（`env_file: .env` で全keyが渡るため追加のみでOK）:
- `dify_api_base` / `dify_api_key` / `dify_app_type`(completion|workflow) /
  `dify_input_var` / `dify_output_var` / `summary_max_chars`

### 2. 要約サービス（新規）— `app/backend/app/services/summarize.py`
- `summarize(text) -> str`。`dify_api_key` 設定時は Dify(`httpx`,blocking) を呼び、
  completion=`/completion-messages`→`answer` / workflow=`/workflows/run`→`data.outputs[var]`。
  未設定/失敗時は `_rule_based_summary`（文分割して先頭抽出）にフォールバック。

### 3. PDF生成サービス（新規）— `app/backend/app/services/pdf_export.py`
- `build_summary_pdf(title, summary) -> bytes`。`reportlab` + 内蔵CJKフォント
  `UnicodeCIDFont("HeiseiKakuGo-W5")` で日本語埋め込み。タイトル見出し + 要約本文。

### 4. エンドポイント — `app/backend/app/api/routes/documents.py`
- `GET /documents/{id}/content` … MinIO から取得し画像バイトを返す（content-typeは file_format推定）。
- `GET /documents/{id}/pdf` … OCR未完了は409、それ以外は要約→PDFを `application/pdf` で返す。

### 5. 依存 — `app/backend/requirements.txt`
- `httpx`, `reportlab` を追加。backend / ocr-worker を再ビルド。

---

## モバイル
1. `npx expo install expo-sharing expo-file-system`。
2. `src/api/client.ts`: `getToken()` と baseURL を export。
3. `src/screens/DocumentDetailScreen.tsx`（新規）: 画像プレビュー + 「要約PDFを出力」。
   `FileSystem.downloadAsync`(認証ヘッダ付き) で画像/ PDF を取得、PDFは `Sharing.shareAsync`。
4. `src/screens/DocumentListScreen.tsx`: 行を TouchableOpacity 化し Detail へ遷移。
5. `App.tsx`: `Detail` スクリーン追加。

---

## 設定/ドキュメント
- `platform/.env.example` に Dify セクション追記。
- `doc/operation.md` に動作フロー・Dify設定・新エンドポイントを追記。

---

## 検証
1. `docker compose build backend ocr-worker && docker compose up -d`。
2. curl: `/documents/{id}/content`(画像200) / `/documents/{id}/pdf`(`%PDF`開始, 日本語化けなし)。
3. 実機: 一覧タップ→画像表示、PDF出力→共有シート→PDFで要約確認。

---

## 進捗ログ
- (着手) 計画を doc/ に出力。
- バックエンド実装完了: config に Dify 設定、`summarize.py`（Dify+フォールバック）、
  `pdf_export.py`（reportlab/CJK）、`/documents/{id}/content` と `/documents/{id}/pdf`、
  requirements に httpx/reportlab 追加 → backend/ocr-worker 再ビルド。
- バックエンド検証(curl): `/content`=200 JPEG(1920x1032)、`/pdf`=200 `%PDF` 1ページ、
  PDF内の日本語タイトルが化けず抽出可能を確認。
- モバイル実装完了: expo-sharing/expo-file-system 追加、`client.ts` に getToken/API_V1_BASE、
  `DocumentDetailScreen`（画像プレビュー+要約PDF出力→共有）、一覧の行タップ遷移、App.tsx に Detail。
  `tsc --noEmit` 通過。Expo を `--clear` で再起動。
- ドキュメント更新: `.env.example` に Dify セクション、`operation.md` に動作フロー/Dify設定/新API、
  `task.md` の T-401/402 を [~]、新規 T-409 追加・進捗サマリ整合。
- **残**: 実機での最終確認（一覧→詳細で画像表示、要約PDF出力→共有シート）。

### 追加機能: 検索可能な電子資料PDFの自動生成・保存 (F-14)
- 要望「撮影画像を電子資料のように生成し直して保存」に対応。種別=検索可能PDF、保存先=サーバー自動保存。
- ocr-worker Dockerfile に `ghostscript` 追加（ocrmypdf に必須）。
- `pdf_export.build_searchable_pdf(image, lang)` を追加（ocrmypdf で画像＋透明OCR層のPDF生成）。
- OCRワーカーが OCR完了後に自動生成し MinIO `{id}/document.pdf` へ保存（失敗してもOCR成功は維持）。
- 取得API `GET /documents/{id}/document-pdf`（未生成は404）。モバイル詳細に「電子資料PDF（検索可能）を保存」ボタン。
- **不具合対応**: ocrmypdf 16.4.1 と pikepdf 10.8 が非互換（`Pdf.check()` 削除）→ `pikepdf==8.15.1` に固定。
- 検証: 既存 done 2件で生成成功（282KB/329KB）、`/document-pdf`=200、PDF内に透明テキスト層あり（抽出可）を確認。
- **残**: 実機で「電子資料PDFを保存」→共有シート→PDFを開いて文字選択できることの確認。
