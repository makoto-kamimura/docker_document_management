# 計画: ユーザー・権限のマスタ管理画面（+ ドキュメントACL）

> 実装の計画・進捗ログ。`doc/task.md` のチェック更新と併用する。

## Context
User モデルとログインのみで、ユーザー管理API・画面が無い（T-106/F-38 未着手）。権限も
JWT に role を載せるだけでドキュメント単位のアクセス制御 (F-36/F-37) が無い。本変更で:
1. ユーザーのマスタ管理（CRUD + ロール割当）— F-35/F-38
2. ドキュメント単位ACL（閲覧/編集/削除）— F-36/F-37
を Web 管理画面から行えるようにする。初期PWは管理者が入力。フォルダACLは対象外。

## バックエンド
- 新モデル `models/document_permission.py`（`DocumentPermission` + `PermissionLevel` view<edit<delete）。
  新テーブルのため `create_all` で自動作成（移行不要）。`main.py` で import。
- スキーマ `schemas/user.py` / `schemas/acl.py`。
- ルート `routes/users.py`（admin限定 CRUD, 最後の管理者保護/自己操作ガード）、`auth.py` に `/auth/me`、
  `documents.py` に ACL 3エンドポイント（admin or owner）。`main.py` に users ルーター登録。
- `deps.py` に `ensure_can_access`。`GET /documents/{id}`・`/content`・`/pdf`・`/document-pdf` と
  一覧の絞り込みに適用（admin/owner は全許可）。

## Web (app/web)
- `api/client.ts`: User/Permission 型 + `getMe`・users CRUD・ACL 関数。
- `main.tsx`: `MeProvider`(Context) で現在ユーザー取得、サイドバー実데이터化、admin限定ナビ/ルート。
- `pages/UsersPage.tsx`（新規, admin限定）: 一覧/作成モーダル/ロール変更/PWリセット/削除。
- `pages/DocumentsPage.tsx`: 行に「権限」→ ACL モーダル。
- `index.css`: モーダル/select/role バッジの最小クラス追加。

## 検証
1. backend 再起動で `document_permissions` 自動作成。
2. curl: `/auth/me`、`/users` 作成、最後のadmin保護、ACL 付与 → viewer ログインで一覧絞り込み/403。
3. Web: admin で管理画面、viewer で再ログインしてナビ非表示・ACL反映。

## 進捗ログ
- (着手) 計画を doc/ に出力。
- バックエンド完了: `DocumentPermission` モデル（新テーブル, `create_all` で自動作成）、
  `schemas/user.py`・`schemas/acl.py`、`routes/users.py`（admin限定CRUD, 自己/最後の管理者ガード）、
  `/auth/me`、documents に ACL 3エンドポイント、`deps.ensure_can_access` を read系/一覧に適用。
  DocumentRead に `owner_id` 追加。
- バックエンド検証(curl): `/auth/me`=admin、ユーザー作成201/一覧、email重複409、自己降格/自己削除400、
  ACL付与200 → viewer ログインで一覧1件・付与content200/未付与403、`/users`は viewer 403、剥奪後0件。
- Web完了: client に User/Permission 型+API、`MeProvider`/`useMe`、サイドバー実データ化、
  admin限定ナビ＆`/users`ルート（`RequireAdmin`）、ログイン後はフルリロードで me 反映、
  `UsersPage`（一覧/作成モーダル/ロール変更/PWリセット/削除）、DocumentsPage に「権限設定」モーダル、
  index.css にモーダル/select/ACL/ボタン拡張。`tsc --noEmit` と `vite build`（90 modules）成功。
- ドキュメント: task.md（T-101/102/106=完了, T-103/104=進行中, 進捗サマリ整合）、operation.md に
  「4. ユーザー・権限管理」節と新API表を追記。
- 検証用に viewer@example.com / reg@example.com を作成済み（Web/実機の権限テストに利用可）。
- **残**: Web 実機操作の最終確認（admin で管理画面操作、viewer で再ログインしてナビ非表示・ACL反映）。
