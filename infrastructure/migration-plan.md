AppConfig 移行手順

目的: 既存の環境変数のうち運用で動的に切り替えたいキーを DynamoDB の `AppConfig` テーブルへ移行する。

前提
- AppConfig テーブル名: `AppConfig`（Key/Value）
- 事前にテーブルを作成済みであること
- コピー対象の env は事前にバックアップ（.env.backup）を取得しておくこと

主要ステップ

1) 準備
  - .env ファイルのコピーを作成: `cp .env .env.backup`
  - AWS credentials が正しいことを確認

2) 移行対象キーの確認
  - 最初の移行対象: `MASTER_DISCORD_WEBHOOK`, `TBL_DELETION_QUEUE`, `THREADS_OAUTH_REDIRECT_PROD`, および削除処理に関わるその他のキー
  - 完全リストは `env_keys_to_migrate.txt` に記載する

3) スクリプトを使って移行
  - `node scripts/migrate-env-to-config.js` を実行
  - 実行はアクセス可能な AWS 資格情報（管理者または適切な DynamoDB 書込権限）で行う

4) サービス側の反映
  - `src/lib/config.ts` の `loadConfig()` を各サーバ起動時に呼ぶようにする（既に導入済み）
  - 本運用ではサーバ再起動で設定を反映するため、各サービスを順次再起動する
  - さらにビルド時 env 生成も導入: CI で `node scripts/generate-env-from-config.js > .env` を実行し、Amplify ビルド等で利用する。

5) 検証
  - DynamoDB Console で `AppConfig` にキーが存在することを確認
  - サーバを再起動後、ログ/UI で新設定が反映されることを確認

6) ロールバック
  - 問題が発生した場合、`AppConfig` から該当キーを削除し（もしくは .env.backup を復元して）サービスを再起動

注意事項
- シークレットは平文保存の方針（ユーザ指定）であるが、アクセス制御は厳格に行うこと（IAM, Logging）。
- Amplify のビルド時に必要な env は移行対象から除外すること。Amplify 用の変数は別途 CI の初期ステップで env に注入する。
-
当該リポジトリ内に存在した DeletionQueue 関連の草案ファイル（`infrastructure/deletion-queue.yml`, `infrastructure/lambda-policy.json`, `infrastructure/iam-policies.md`, `infrastructure/amplify-policy.json`）は、今回ユーザーの指示により削除済みです。これらは草案であり、実運用用の適用は行っていません。
削除理由: IAM 権限は既に付与済みであり、草案のままリポジトリに残しておく必要がないため。必要な場合は過去コミット履歴から復元可能です。

追加: 投稿全削除（運用メモ）

- **AppConfig キーの反映**: 本リポジトリでは投稿一括削除の動作パラメータを DynamoDB の `AppConfig` より読み取るように統一しました。
  - `DELETION_BATCH_SIZE`: 定期ワーカーおよび API 側のバッチ上限件数（未指定時は 100 を使用）。
  - `TBL_DELETION_QUEUE`: DeletionQueue テーブル名（API/ワーカーは AppConfig を優先して参照）。
  - `DELETION_PROCESSING_INTERVAL_HOURS`: 定期ワーカーが再実行可能とみなす間隔（既定 24h）。
  - `DELETION_RETRY_MAX`: キュー処理失敗時の最大再試行回数（既定 3）。
  - `DELETION_NOTIFY_ON_ERROR`: エラー時に通知を行うか（true/false）。

- **運用注意**: API 側とユーティリティの挙動を統一するため、`limit` 引数は呼び出し側から渡さず、`deleteUserPosts` 側で AppConfig を参照して上限を決定する設計に変更しました。これによりソースの可読性が向上します。


