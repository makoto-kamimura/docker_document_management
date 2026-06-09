# 計画: フェーズ2(撮影・取り込み)全実装 + 一覧の2タブ追加

> 実装の計画・進捗ログ。`doc/task.md` のチェック更新と併用する。

## Context
- フェーズ2(T-201〜T-211)を一通り実装。Expo Go の制約上、画像処理系(輪郭/台形/補正/グレースケール/影)は
  **バックエンドのOpenCV(ワーカー)でアップロード時に自動処理**（ベストエフォート）。
- ドキュメント一覧に **未読/既読タブ** と **一覧/サムネイルタブ** を Web・モバイル両方に追加。

## Part A: フェーズ2
- A1 `services/image_processing.py`(OpenCV): `scan_page(bytes, mode)` → 台形補正+トリミング、CLAHE補正、
  mode(color/gray/bw)、quality(ブレ/明るさ/解像度/影)。
- A2 `create_document`: `files: list[UploadFile]` + `mode`。生ページを `{id}/pages/{i}` に保存、page_count=N。
- A3 ワーカー: 各ページ scan_page → `{id}/proc/{i}`、先頭を `{id}/preview.jpg`、全ページを img2pdf→ocrmypdf で
  `{id}/document.pdf`(複数ページ)、OCR全ページ連結、`{id}/quality.json` 保存。
- A4 モバイル CameraScreen: 連続複数撮影・ページサムネイル・モード選択・プレビュー/削除/並べ替え/再撮影。
- A5 既存画像/PDF取込: expo-image-picker / expo-document-picker。
- A6 画質チェック: 端末=解像度警告、サーバー=quality を詳細で表示。
- A7 オフライン同期: async-storage で未送信キュー、復帰時自動再送＋手動同期。

## Part B: タブ
- B1 未読/既読: すべて/未読/既読 で is_read フィルタ。
- B2 一覧/サムネイル: /content を認証付き取得しグリッド表示（Web=blob URL, モバイル=FileSystem）。

## 検証
backend 再ビルド→複数ページ+mode アップロード→preview/複数ページPDF/quality 生成、/content が処理済み。
Web/モバイル tsc・build、タブ動作。単一ページ後方互換。

## 留意点
画像処理はベストエフォート。モバイルは tsc+bundle まで確認、カメラ実機確認は利用者側。

## 進捗ログ
- (着手) 計画を doc/ に出力。
- バックエンド完了: `services/image_processing.py`(OpenCV: 輪郭検出→透視変換→CLAHE→mode→quality)、
  `create_document` を複数ページ(`files`)+`mode` 対応(id明示生成でキー確定)、ワーカーを
  ページ処理→`proc`/`preview.jpg`保存→img2pdf+ocrmypdf(sidecar)で複数ページ検索可能PDF→`quality.json` へ刷新、
  `/content` は preview.jpg 優先、`/quality` 追加。pdf_export に複数画像/既存PDF用の関数追加。
- バックエンド検証(curl): 2ページ+mode=gray アップロード→processed、`/content`=処理済み(台形補正 cropped=true)、
  `/document-pdf`=2ページ検索可能PDF(OCRテキストあり)、`/quality`=警告/指標、グレースケール確認。
- モバイル完了: image-picker/document-picker/async-storage 追加、`client.uploadDocument` 複数+mode、
  `CameraScreen` 刷新(連続撮影/モード/サムネイル/削除/並べ替え/ライブラリ・PDF取込/低解像度警告)、
  `src/offline.ts`(退避→自動/手動再送)、`DocumentListScreen` に未読/既読タブ+リスト/サムネイル切替。
- Web完了: `DocumentsPage` に未読/既読タブ+リスト/サムネイルグリッド(認証blobサムネイル)、index.css 追加。
- 検証: Web `vite build` 成功、モバイル `tsc` + Metro バンドル(新モジュール解決)成功。
- ドキュメント: task.md(T-201〜211 更新, T-209は[~], T-301=完了, サマリ 17/66)、operation.md(撮影フロー/画像処理/タブ/新API)。
- **残**: 実機でのカメラ系最終確認（複数撮影/モード/取込/オフライン同期）と Web/実機のタブ・サムネイル目視。
