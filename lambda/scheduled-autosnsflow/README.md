# Scheduled AutoSNSFlow Lambda

拡張された定期実行処理システムです。複数のタスクをスケジュールに基づいて実行し、包括的な監視と通知を提供します。

## 機能

### 🚀 実行タスク
- **アカウント通知**: Threadsアカウント一覧をDiscordに通知
- **統計情報収集**: アカウントの統計情報を収集・分析
- **エラー監視**: システムエラーを監視・アラート
- **自動投稿**: 設定された投稿を自動実行

### 📅 スケジュール管理
- 複数のスケジュールパターン対応
- cron式とrate式の両方に対応
- スケジュール別のタスク実行制御
- 環境別設定管理

### 📊 ログ・監視
- 構造化ログ出力
- CloudWatch統合
- Discord通知統合
- エラーハンドリング・リトライ

## アーキテクチャ

```
handler.ts (Lambda Entry Point)
    ↓
scheduler.ts (タスク実行制御)
    ↓
tasks.ts (各タスクの実装)
    ↓
config.ts (設定管理)
    ↓
logger.ts (ログ・通知)
```

## 設定

### 環境変数
```bash
DEFAULT_USER_ID=your-default-user-id
MASTER_DISCORD_WEBHOOK=your-discord-webhook-url
NODE_ENV=production
```

### スケジュール設定
`schedules.yml` でスケジュールパターンを定義：

```yaml
schedules:
  accountNotification:
    expression: "rate(1 hour)"
    enabled: true
    tasks:
      - accountNotification
```

## 使用方法

### 1. 基本的な実行
```typescript
// デフォルト設定で全タスクを実行
const result = await handler({});

// 特定のスケジュールを実行
const result = await handler({
  scheduleName: "accountNotification"
});

// 特定のユーザーで実行
const result = await handler({
  userId: "custom-user-id"
});
```

### 2. カスタム設定
```typescript
import { TaskScheduler } from "./scheduler";

const scheduler = new TaskScheduler({
  tasks: {
    autoPost: true,
    errorMonitoring: false
  },
  logging: {
    level: "debug"
  }
});

const result = await scheduler.execute({
  scheduleName: "custom"
});
```

### 3. スケジュール作成
```bash
# 5分ごとの実行
bash create-or-update-schedule.sh ap-northeast-1 scheduled-autosnsflow "rate(5 minutes)"

# 毎日午前9時
bash create-or-update-schedule.sh ap-northeast-1 scheduled-autosnsflow "cron(0 9 * * ? *)"
```

## デプロイ

### 手動デプロイ
```bash
npm run deploy
```

### CI/CD デプロイ
`lambda`ブランチにpushすると自動的にデプロイされます。

## テスト

### ローカルテスト
```bash
npm run test:local
```

### Lambda関数テスト
```bash
npm run test:lambda
```

### AWS CLI テスト
```bash
aws lambda invoke \
  --function-name scheduled-autosnsflow \
  --payload '{"scheduleName":"accountNotification"}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

## 監視・ログ

### CloudWatch ログ
- 構造化ログ形式で出力
- ログレベルによる制御
- エラー時の自動通知

### Discord 通知
- タスク実行結果の通知
- エラーアラート
- 統計情報レポート

## 拡張方法

### 新しいタスクの追加
1. `tasks.ts` に新しいタスク関数を追加
2. `scheduler.ts` の `executeTask` メソッドにケースを追加
3. `config.ts` の設定に追加
4. スケジュール設定に追加

### 新しい通知チャンネルの追加
1. `logger.ts` に新しい通知メソッドを追加
2. `config.ts` の通知設定に追加
3. 環境変数で設定可能にする

## トラブルシューティング

### よくある問題
1. **権限エラー**: Lambda関数にEventBridge実行権限が必要
2. **タイムアウト**: タスク実行時間が長すぎる場合は設定を調整
3. **メモリ不足**: 複雑な処理の場合はメモリ設定を増加

### ログ確認
```bash
# CloudWatch ログの確認
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/scheduled-autosnsflow"

# 最新のログストリームを確認
aws logs describe-log-streams \
  --log-group-name "/aws/lambda/scheduled-autosnsflow" \
  --order-by LastEventTime \
  --descending \
  --max-items 1
```

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。
