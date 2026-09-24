# mobile — 撮影・閲覧モバイルアプリ

React Native (Expo) + TypeScript。紙資料の撮影・取り込み・閲覧を行う。

## 技術スタック
- Expo / React Native / TypeScript
- expo-camera（撮影）, expo-image-manipulator（補正/最適化の足場）
- expo-notifications / expo-constants（プッシュ通知。projectId 設定時のみ有効）
- @react-navigation, axios

## ディレクトリ
```
App.tsx                    # ナビゲーション / 401時のログイン復帰 / プッシュのタップ処理
src/
├── api/client.ts          # APIクライアント（アップロード・家族・通知）
├── offline.ts             # オフライン撮影の退避と再送 (F-11)
├── push.ts                # プッシュ通知の登録（EAS projectId 設定時のみ有効）
├── components/            # サムネイル・重要/期限バッジ・家族パネル・🔔バッジ
└── screens/
    ├── CameraScreen.tsx        # 撮影・アップロード (F-01, F-08, F-12)
    ├── DocumentListScreen.tsx  # 一覧（すべて/未読/重要/期限あり/既読）(F-21, F-22)
    ├── DocumentDetailScreen.tsx# 詳細・家族の確認状況・対応・コメント・PDF出力
    ├── NotificationsScreen.tsx # お知らせ一覧
    └── SearchScreen.tsx        # 全文検索 (F-23〜F-26)
```

## 起動
```bash
npm install
EXPO_PUBLIC_API_BASE_URL=http://<開発機のIP>:8000 npm start
```
→ Expo Go アプリ、または iOS/Android エミュレータで実行。

## プッシュ通知の有効化（任意）

未設定でも**アプリ内通知**（お知らせ一覧・🔔バッジ・再通知・リマインド）は動く。
実機へのプッシュ通知を使う場合のみ、以下を設定する。

1. Expo (EAS) でプロジェクトを作成し、projectId を取得する
2. `app.json` に projectId を追加する
   ```json
   { "expo": { "extra": { "eas": { "projectId": "<あなたのprojectId>" } } } }
   ```
3. アプリを再起動してログインすると、端末のトークンがサーバーに登録され、プッシュが届くようになる

- Expo Go では **iOS のみ**プッシュを受け取れる（Android は SDK 53 以降 Expo Go 非対応。開発ビルドが必要）。
- プッシュ本文には書類の中身を載せない（Expo/Apple/Google のサーバーを経由するため）。
  内容はアプリ内通知で確認する。
- サーバー側で止める場合は `PUSH_ENABLED=false`（アプリ内通知は残る）。

## 未実装（task.md 参照）
- 輪郭検出・台形補正・画質最適化 (F-03〜F-05) … 端末側 OpenCV/画像処理
- 影/指写り検出 (F-07)、品質チェック (F-09)、オフライン同期 (F-11)
