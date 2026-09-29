# docs

仕様書の本体はリポジトリ直下の [README.md](../README.md)。`docs/` には、それ以外の資料を種類ごとのフォルダに分けて置く。

| フォルダ | 置くもの | 書く人 |
|---|---|---|
| [design/](design/) | 設計・計画の資料（初期の[要件定義書](design/requirements.md)、機能ごとの実装計画 `plan-*.md`。例: [テナント分離](design/plan-tenants.md)・[家族での共有・通知](design/plan-family-notify.md)） | 人 |
| [runbooks/](runbooks/) | 運用手順書（[起動・運用手順](runbooks/operation.md)。作業ごと・アラートごとに追加する） | 人 |
| [incidents/](incidents/) | 障害のふりかえり（`YYYY-MM-DD-<概要>.md`） | 人 |
| [automation/](automation/) | 仕分けと実装のルーティンの手順 | 人（エージェントに変えさせない） |
| [tasks/](tasks/) | 開発タスクの一覧（[task.md](tasks/task.md)）と、不具合・要望のタスク（1タスク1ファイル） | 人・仕分けのルーティン |

- まだ中身のないフォルダには、フォルダを git に残すための `.gitkeep` を置いている。中身ができても消さなくてよい。
- 不具合・要望のタスクは `tasks/` にだけ置く。設計・運用の資料と混ぜない。
- 仕様（何を作るか・どう動くか）が変わったら、まず [README.md](../README.md) を直す。`design/` の計画書は、その時点の記録として残す。
- `runbooks/qr.md`・`runbooks/qr.png`（Expo Go の接続用 QR）は非公開のファイルで、`.gitignore` で除外している。
