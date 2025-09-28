# 🚀 デプロイメント注意事項

## AWS Amplify デプロイ時の注意点

### 1. Next.js 設定ファイル
**❌ 問題**: `next.config.ts` は AWS Amplify でサポートされていません  
**✅ 解決策**: `next.config.mjs` または `next.config.js` を使用する

```javascript
// ❌ これは動きません
// next.config.ts

// ✅ これを使用してください  
// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = { /* 設定 */ };
export default nextConfig;
```

### 2. GitHub Actions と Lambda デプロイ

#### 自動デプロイのトリガー条件
Lambda関数が自動デプロイされる条件：
- `lambda` ブランチへのプッシュ
- 以下のパスに変更がある場合のみ：
  - `lambda/**`
  - `packages/**`
  - `.github/workflows/deploy-scheduled-lambda.yml`

#### フロントエンドのみの変更時の対応
フロントエンドファイル（`src/`）のみを変更した場合、Lambda関数は自動デプロイされません。
Lambda関数も更新したい場合は以下を実行：

```bash
# Lambda関数の任意のファイルにコメントを追加してコミット
git add lambda/scheduled-autosnsflow/src/handler.ts
git commit -m "chore: trigger Lambda deployment"
git push origin lambda
```

### 3. 手動デプロイ方法（緊急時）

```bash
# Lambda関数の手動デプロイ
cd lambda/scheduled-autosnsflow
npm run build
npm run zip
npm run deploy:cli
```

### 4. よくあるビルドエラーと対処法

#### Error: next.config.ts is not supported
```bash
# 解決方法
mv next.config.ts next.config.mjs
# ファイル内容もJavaScript形式に変更
```

#### Error: no frontend-related change -> skip build
`scripts/should-build-frontend.sh` のパターンが更新されていない場合：
```bash
# next.config.mjs が認識されるよう正規表現を修正
# PATTERN に next\.config\.(js|ts|mjs) を含める
```

#### Error: Can't find required-server-files.json
ビルドがスキップされた場合に発生。上記のパターン修正で解決。

#### TypeScript build errors
```bash
# 一時的な回避（推奨しません）
# Amplify環境変数に追加: IGNORE_TS_ERRORS=1
```

### 5. デプロイ前チェックリスト

- [ ] `next.config.mjs` が存在し、`.ts` ファイルが削除されている
- [ ] Lambda関数に変更がある場合、`lambda/**` パスのファイルが変更されている
- [ ] TypeScriptエラーがないことを確認
- [ ] ESLintエラーが許容範囲内であることを確認

### 6. 環境別ブランチ運用

- `main`: 本番環境
- `staging`: ステージング環境
- `lambda`: Lambda関数開発・デプロイ用

**注意**: `lambda`ブランチの変更は自動的にLambda関数にデプロイされます。

### 7. 追加ルール（Threads OAuth / 削除機能）

- Threads OAuth を利用するには各アカウントごとの App ID と App Secret が必要になる場合があります。運用上は以下を満たしてください。
  - **固定のコールバックURL** を Facebook App の `Valid OAuth Redirect URIs` に登録しておくこと（例: `https://your-domain.com/api/auth/threads/callback` / `http://localhost:3000/api/auth/threads/callback`）。
  - フロントエンドからは `/api/auth/threads/start?accountId=<id>` を呼ぶだけで、サーバ側が該当アカウントの client_id を選択してリダイレクトします。
  - アプリの `threads_delete` 権限を使用する場合はユーザーの再同意（re-consent）が必要です。

- 投稿削除の運用ルール:
  - 削除は Threads の API 制限（1アカウントあたり24時間で最大100件）を尊重すること。
  - UI からの削除は二重確認を必須とし、削除実行後は `ExecutionLogs` に結果を残すこと。
  - 大量削除を行う場合は即時100件まで削除し、残件は専用キュー (`DeletionQueue`) に保管して24時間後に再試行する（`daily-prune` を hourly に変更して利用することも検討）。

