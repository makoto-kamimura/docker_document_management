# 計画: グループ機能 + グループ自動共有 + 既読管理

> 実装の計画・進捗ログ。`doc/task.md` のチェック更新と併用する。

## Context
ユーザー登録は管理者のみ（現状維持）。これに加えて:
1. **グループ**（部署/チーム）— 管理者がグループとメンバーを管理。
2. **グループ自動共有** — アップロード者と同じグループのメンバーはそのドキュメントを自動で閲覧可（F-36拡張）。
3. **既読管理 (F-32)** — 閲覧でユーザー＋日時を記録。各自が未読/既読を確認でき、所有者/管理者は既読者一覧も見られる。

新規テーブルのみ（`create_all` 自動作成、移行不要）。per-user ACL は併存。

## バックエンド
- 新モデル `group.py`(Group, GroupMember) / `read_receipt.py`(DocumentReadReceipt)。main.py で import。
- スキーマ `group.py` / `read.py`、DocumentRead に `is_read`。
- `routes/groups.py`（admin限定）CRUD+メンバー。main 登録。
- documents.py: 閲覧で既読 upsert、create時に所有者既読、一覧は共通グループで絞り込み+is_read、
  `GET /documents/{id}/reads`（所有者/管理者）。
- deps.py: 共通グループ判定 + `can_access` に view 自動共有を追加。

## Web
- client.ts: Group/ReadReceipt 型+API、DocumentRead.is_read。
- GroupsPage（admin）, main.tsx に /groups ルート+ナビ。
- DocumentsPage: 未読/既読バッジ + 既読者モーダル。

## モバイル
- DocItem に is_read、一覧バッジ、詳細で既読化（/content取得）＋所有者に既読者数。

## 検証
1. テーブル自動作成。2. グループ作成→メンバー追加。3. メンバーの自動共有(200)/非メンバー(403)。
4. 閲覧で is_read=true・/reads に出る。5. Web/モバイルのバッジ・既読者一覧。

## 進捗ログ
- (着手) 計画を doc/ に出力。
- バックエンド完了: `Group`/`GroupMember`/`DocumentReadReceipt` モデル（新テーブル, 自動作成）、
  `schemas/group.py`・`schemas/read.py`、DocumentRead に `is_read`、`routes/groups.py`（admin限定 CRUD+メンバー）、
  documents に 既読upsert・一覧の共通グループ絞り込み+is_read・`GET /documents/{id}/reads`、
  `deps.shares_group`/`co_member_user_ids` と `can_access` の view 自動共有。
- バックエンド検証(curl): グループ作成/メンバー追加(204, member_count)、同一グループの viewer が自動共有で
  一覧表示・content200・開封で is_read=true、既読者一覧に viewer+所有者、グループから外すと即 0件/403。
- Web 完了: client に Group/ReadReceipt 型+API、`GroupsPage`（作成/削除/メンバー管理モーダル）、
  `/groups` admin ルート+ナビ、DocumentsPage に 未読/既読バッジ+「既読者」モーダル、index.css バッジ追加。
  `vite build` 成功。
- モバイル完了: 一覧に未読ドット＋未読/既読バッジ、詳細に既読者一覧（所有者/管理者のみ200）。`tsc` 成功。
- ドキュメント: task.md（T-107新規=完了, T-506=完了, T-503=進行中, T-103にグループ追記, サマリ整合）、
  operation.md に「グループと自動共有」「既読管理」節と新API追記。
- 検証データ: グループ「営業部」(reg/viewer 所属)・reg 所有の「営業資料A」を作成済み。
- **残**: Web/モバイル実機での最終確認（グループ管理、自動共有での閲覧、未読→既読、既読者一覧）。
