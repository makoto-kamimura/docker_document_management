# web — 管理・検索 Webアプリ

React + TypeScript (Vite) のSPA。ドキュメント管理・全文検索・ログ照会を行う。

## 技術スタック
- React 18 / TypeScript / Vite
- react-router-dom / axios

## ディレクトリ
```
src/
├── main.tsx          # ルーティング / レイアウト
├── api/client.ts     # APIクライアント (JWT付与)
└── pages/
    ├── DocumentsPage.tsx   # 一覧 (F-21)
    └── SearchPage.tsx      # 全文検索 (F-23〜F-25)
```

## 起動
```bash
npm install
cp .env.example .env
npm run dev
```
→ http://localhost:5173

> バックエンド (../backend) と OpenSearch が起動している前提。compose 一括起動は ../../platform を参照。
