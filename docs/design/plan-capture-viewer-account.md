# 計画: 撮影・閲覧の改善、表示名の変更、要約の廃止と OCR の精度向上（2026-11-04）

> 実装の計画と決定の記録。仕様の正は [README.md](../../README.md)（5章・7〜9章・13章・17.1〜17.4節・D4・D5）。
> タスクは [task.md](../tasks/task.md) のフェーズ14。

## Context

スマホで紙を撮って家族で確認する流れについての要望。

- 撮影中にカテゴリを選びたい（確認画面でしか選べなかった）。書類を枠に合わせて撮りたい。
- 書類タブのカテゴリを「すべて」「未読」などの絞り込みより上に置き、アイコン付きにして、幅の狭いスマホでも全部見えるようにしたい。
- 画像は高さ 380pt 固定で拡大できず、小さい字が読めない。
- 「あなたの対応」をアイコンにし、その上にコメント欄を置き、対応を押したら一覧へ戻りたい。
- 自分の名前を変えたい（管理者しか変えられず、スマホには自分の名前が出なかった）。
- 要約は使っていないので削除し、そのぶん OCR の精度を上げたい。

確認した方針:

- OCR は外部のクラウド OCR・LLM には送らない（処方箋など家庭の書類のため）。当初は「読み取りが崩れたページだけ PaddleOCR で読み直す」計画だったが、
  評価の結果（下の I）で、**本文はすべて PaddleOCR で読み、検索可能 PDF のテキスト層だけ Tesseract** に変えた。サーバーの空きメモリが少ないので、PaddleOCR は別プロセスで動かす。
- 検索に N-gram と読み仮名を足し、OCR の読み違いやひらがな入力でも見つかるようにする。
- カテゴリのアイコンはプリセットのアイコン（Ionicons）と色から選ぶ。絵文字は使わない（OS で見た目が変わるため）。
  [plan-categories.md](plan-categories.md) の「アイコン画像は作らない」を、この形で更新する。
- 対応のバーは詳細画面の下に固定する（画像を見ながら押せる）。
- スマホ標準の書類スキャナ（VisionKit / ML Kit）は見送る。Expo Go では動かず、開発ビルドへの切り替えが必要なため。

## A. 撮影画面（モバイル）

- `CategoryPicker`（`src/components/CategoryPicker.tsx`）: 撮影画面（dark）と確認画面（light）で同じ部品。選んだカテゴリは確認画面に引き継ぐ。
- `DocumentGuide`（`src/components/DocumentGuide.tsx`）: カメラの上に A4 縦の枠（画面幅の 88% か高さの 82% の小さいほう）と四隅の L 字、案内文を重ね、枠の外を暗くする。
  写真は切り取らない（サーバーの輪郭検出・台形補正は余白つきの写真で一番よく働く）。
- `takePictureAsync({ quality: 1 })`。expo-camera の `autofocus="on"` は「一度合わせて固定」なので使わず、既定（必要に応じて合わせ直す）のままにする。

## B. カテゴリのアイコン・色

- `categories.icon`（Ionicons の名前から `-outline` を除いた形、`^[a-z0-9-]{1,40}$`）と `categories.color`（`slate` / `indigo` / `sky` / `emerald` / `amber` / `orange` / `rose` / `violet`）。
  既存 DB には `migrate.add_category_style_columns()` で列を足し、既定カテゴリ（投函チラシ=newspaper/amber、重要書類=shield-checkmark/indigo、処方箋=medkit/rose）に値を入れる。
- 書類の一覧・詳細にも `category_icon` / `category_color` を付ける（チップの表示用）。
- 選べるアイコンは28個。Web（react-icons/io5）とモバイル（@expo/vector-icons）の両方にあることを確かめた。一覧にない値は folder で表示する。
- Web のカテゴリ管理: 作成フォームにアイコンのグリッドと色の見本、表のアイコンを押すと変更のモーダル。

## C. 書類タブ（モバイル）

- 上から「カテゴリ（すべて・各カテゴリ・未分類。アイコン付きのチップを折り返して全部表示）」→「状態（すべて / 未読 / 重要 / 期限あり / 既読。等幅のセグメントで1行、件数は右上の小さなバッジ）」→ 一覧。
- 一覧 / サムネイルの切り替えはヘッダー右へ移した。横スクロールはしない。

## D. 画像の全画面表示（モバイル）

- `react-native-gesture-handler`（v3 のフック API）・`react-native-reanimated`・`react-native-worklets` を追加した（Expo Go に同梱。`npx expo install` で SDK 58 に合う版）。
- `ImageViewer`（`src/components/ImageViewer.tsx`）: 黒背景の全画面 Modal。ピンチは指の中心を基準に 1〜6倍、拡大中は1本指で移動（画像の端で止める）、ダブルタップで 1倍 ↔ 2.5倍（押した位置を中心）。複数ページは下のページ送り。

## E. 詳細画面の対応バー（モバイル）

- `useDocFamily`: 家族の確認状況とコメントを `FamilyPanel`（表示）と `ActionBar`（送信）で共有する。
- `ActionBar`（画面下に固定）: 上にコメント欄と ➤（コメントだけ送って残る）、下に4つのアイコン（確認した=eye / 対応する=flag / 対応済み=checkmark-done-circle / あとで確認=time）。
  対応を押すと、入力中のコメントがあれば先に送り、対応を保存して `goBack()`（開く前の一覧＝書類・検索・お知らせ）。戻れなければ書類タブへ。失敗したら残る。
- `KeyboardAvoidingView`（iOS は padding、ずらす量は `useHeaderHeight`）。Web の詳細は変えない。

## F. 表示名の変更

- `PATCH /auth/me`（`{name}`、1〜100文字・前後の空白は除く）。ログイン中の本人なら誰でも（子供も）。
  コメント・家族の一覧の名前は表示のたびに `users.name` を引くので、過去のコメントにも新しい名前が出る。
- モバイル: タブのヘッダー右に頭文字のアバターと名前（`AccountButton`）。押すとアカウント画面（表示名・メール・テナント・役割・ログアウト）。`MeProvider` で共有する。
- Web: サイドバーの名前を押すと表示名の変更。管理者はユーザー管理の「名前変更」でも変えられる。

## G. 要約の廃止

- 削除: `services/summarize.py`、ワーカーの要約生成と `summary.txt` の保存、`GET /documents/{id}/pdf`（要約PDF）、`build_summary_pdf`、
  検索の `summary` フィールド、`DIFY_*` / `SUMMARY_MAX_CHARS` の設定、Web・モバイルの要約PDFボタン。
- `clean_ocr_text` は `services/ocr_text.py` へ移した。
- 既存の `summary.txt` と索引の `summary` フィールドはどこからも読まれないので、そのままにする。

## H. 検索: OCR の読み違いとひらがな入力

- タイトルと OCR 本文に `.ngram`（2文字区切り）を足し、重みを下げて `minimum_should_match: "2<-34%"` で照合する（区切りが3つ以上なら3分の1までは欠けてよい）。
- 読みは `*_reading` フィールドに、索引時に kuromoji（`ja_reading_tokens`）で読みのカタカナに直して入れ、2文字区切り（トークナイザー）でフレーズ照合する。検索語はひらがなをカタカナにそろえる（ICU を使わず `mapping` の文字フィルター）。
  - 最初に試した「`kuromoji_readingform` の後に ngram トークンフィルター」は、区切りがすべて同じ位置になり1つでも共通すれば当たってしまい（「献立（コンダテ）」で「懇談（コンダン）」が当たる）、採らなかった。
- 既存の索引には、OCR ワーカーの起動時に解析器を足し（索引を一度閉じる）、`_update_by_query` で索引し直す。読みは `backfill_reading` が入れる（`reading_v` が目印）。
- 使い捨ての OpenSearch で確認した例: 「うんどうかい」→運動会、「保護者会」→本文が「保護着会」の書類、「ろきそぷろふぇん」→ロキソプロフェン、「こんだて」→献立。「遠足」「えんそく」「ほごしゃ」（本文は保護着）は当たらない。

## I. OCR の精度

### 評価の方法

`app/backend/scripts/ocr_eval.py`。日本語のお知らせ・給食だより・薬の説明書など8文面を、Noto Sans / Serif CJK で横書き（10枚）・縦書き（2枚）に描き、
机に置いた紙をスマホで撮ったように加工した（台形ゆがみ・片側の影・周辺減光・ぼけ・ノイズ・JPEG。易しい 12MP と難しい 7MP を交互）。
本番と同じ処理（台形補正 → ocrmypdf/Tesseract → 後処理、PaddleOCR は別プロセス）を流し、CER（NFKC・空白を除いた編集距離 ÷ 正解の文字数）を比べた。
合成サンプルなので、実物の写真での値とは違う。実物の写真と正解を足して測り直せるようにしてある。

### 結果

12枚（横書き10・縦書き2）の平均。秒数は4コアのサーバーで3コアに制限して測ったもの（デモのコンテナも動いている状態）。

| 方式 | CER 平均 | CER 中央値 | CER 最大 | 1ページ | 最大メモリ |
|---|---|---|---|---|---|
| Tesseract・カラー（変更前の方式） | 5.3% | 3.6% | 32.7% | 約21秒 | — |
| Tesseract・カラー＋Sauvola しきい値 | 7.5% | 2.9% | — | 約22秒 | — |
| Tesseract・白黒（変更前。二値化した画像を読む） | 33.6% | 20.7% | 93.0% | 約12秒 | — |
| Tesseract・白黒＋Sauvola | 34.2% | 21.1% | — | 約13秒 | — |
| Tesseract・白黒（変更後。グレーで読み、PDF の画像を白黒に） | 2.7% | 0.8% | 15.8% | 約25秒 | — |
| PaddleOCR PP-OCRv6 small（長辺2000px） | 1.6% | 0.8% | 5.3% | 約3.1秒 | 754MB |
| **PaddleOCR PP-OCRv6 small（長辺1600px）＋後処理** | **1.2%** | **0.8%** | **5.3%** | **約2.1秒** | **581MB** |
| PaddleOCR PP-OCRv6 small（長辺1280px） | 1.6% | — | — | 約1.7秒 | 501MB |
| PaddleOCR PP-OCRv6 medium（長辺2000px） | 0.9% | 0.8% | 2.6% | 約12秒 | 1355MB |
| PaddleOCR PP-OCRv5 server（長辺2000px） | 20.4% | 4.6% | 100% | 約23秒 | 2065MB |
| 品質の低いページだけ読み直す（最初の案、しきい値 0.7〜0.9） | 5.3% | 3.6% | 32.7% | — | — |

- PP-OCRv6 small は、12枚すべてで Tesseract と同じかそれより良かった（Tesseract が 32.7% 誤ったページも 3.0%）。
- **品質の低いページだけ読み直す案は一度も発動しなかった**。Tesseract の誤りは記号の羅列ではなく日本語らしい誤字になるため、
  文字の品質スコア（`text_quality`）が誤り率 30% のページでもほぼ満点になり、見分けられなかった。
- 白黒モードの悪化は、二値化した画像を Tesseract に読ませていたことが原因だった（細い字のかすれ・向きの誤判定。縦書きで特に悪い）。
- Sauvola（ocrmypdf の `tesseract_thresholding`）は良くならず、縦書きではかえって悪化した（5.3% → 21.1%）。
- 後処理（カタカナの誤認識補正と、行頭などの「ー」→「一」）で PaddleOCR は 1.5% → 1.2%。
- v5 server は2枚で読めない文字列（100%）になり、メモリも 2GB を超えた。

### 決定

- 画像のページの本文（`documents.ocr_text`。検索・解析・タイトル・OCR 全文 PDF に使う）は **PP-OCRv6 small を長辺 1600px で**読む（`OCR_TEXT_ENGINE=paddle`）。
  PaddleOCR が明らかに読めていない（文字数が Tesseract の半分未満・記号の羅列）ページと、失敗・時間切れのときは Tesseract の結果を使う（`paddle_ocr.choose_text`）。
- 検索可能 PDF のテキスト層（PDF の中の検索）は Tesseract（ocrmypdf）のまま。白黒モードはグレーで OCR してから PDF の画像を白黒にする。
- v6 medium は誤り率がさらに低いが、メモリ 1.4GB・1ページ約12秒で、このサーバーには重い。ビルド引数 `PADDLE_OCR_PRESET=v6-medium` で選べるようにはしてある。
- Sauvola は採らない。品質スコア（`text_quality`）は本文の選び方の補助（記号の羅列の判定）にだけ使う。
- 取込んだ PDF（`file_format=pdf`）は今までどおり Tesseract（既にテキスト層があるページはそのまま）。

計画からの変更: 「Tesseract の画像を差し替える ocrmypdf プラグイン（`dms_ocr_source_dir`）」は作らなかった。`filter_ocr_image` には ocrmypdf が
傾き補正・向き補正をした後の画像が渡るため、別の画像に差し替えるとテキスト層の位置がずれる。白黒モードは「グレーで OCR → PDF の画像だけ白黒に」で解決した。

## 検証

- Backend: `python -m pytest tests`（既存 38 件 + カテゴリのアイコン・色、`/auth/me`、OCR の後処理・品質判定、PaddleOCR の枠の並べ方とページごとの選び方、白黒 PDF の画像の置き換え。計 78 件）
- Web: `npx tsc --noEmit` と `npm run build`
- Mobile: `npx tsc --noEmit`、`npx expo export --platform ios`（worklets の Babel プラグインを含めてバンドルできること）
- 検索: 使い捨ての OpenSearch（デモと同じ kuromoji 入りのイメージ）で、旧形式の索引からの移行（2回流しても冪等）・新規作成・上の検索例
- PaddleOCR のモデル: ワーカーのイメージをビルドし（sha256 の確認つき）、ネットワークを切ったコンテナで焼き込んだモデルだけで読めること
- 検索の移行: 「解析器を足した直後に落ちた」状態からも、次の起動で続き（索引し直しと完了印 `_meta.dms_schema`）が行われること
- 未確認: 実機の Expo Go（タスク T-1409）
