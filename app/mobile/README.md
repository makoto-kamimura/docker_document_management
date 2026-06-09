# mobile — 撮影・閲覧モバイルアプリ

React Native (Expo) + TypeScript。紙資料の撮影・取り込み・閲覧を行う。

## 技術スタック
- Expo / React Native / TypeScript
- expo-camera（撮影）, expo-image-manipulator（補正/最適化の足場）
- @react-navigation, axios

## ディレクトリ
```
App.tsx                    # ナビゲーション
src/
├── api/client.ts          # APIクライアント / アップロード
└── screens/
    ├── CameraScreen.tsx        # 撮影・アップロード (F-01, F-08, F-12)
    └── DocumentListScreen.tsx  # 一覧・閲覧 (F-21, F-22)
```

## 起動
```bash
npm install
EXPO_PUBLIC_API_BASE_URL=http://<開発機のIP>:8000 npm start
```
→ Expo Go アプリ、または iOS/Android エミュレータで実行。

## 未実装（task.md 参照）
- 輪郭検出・台形補正・画質最適化 (F-03〜F-05) … 端末側 OpenCV/画像処理
- 影/指写り検出 (F-07)、品質チェック (F-09)、オフライン同期 (F-11)
