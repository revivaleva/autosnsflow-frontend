# デプロイ・テストチェックリスト

X投稿へのメディア対応機能の デプロイ前・後の確認項目をまとめたガイドです。

---

## 📋 デプロイ前チェック（開発環境）

### コード検証

- [ ] `npm run build` が正常に完了（型エラーなし）
  ```bash
  npm run build
  ```

- [ ] ESLint / TypeScript が通過
  ```bash
  npm run lint
  ```

- [ ] Lambda 関数がビルド可能
  ```bash
  cd lambda/scheduled-autosnsflow
  npm run build
  ```

### ファイル確認

実装されているファイル：

- [ ] `infra/cfn-s3-media.yml` — S3 CloudFormation テンプレート
- [ ] `src/lib/env.ts` — 環境変数設定（S3_MEDIA_BUCKET 追加）
- [ ] `src/pages/api/post-pool/upload-media.ts` — メディアアップロード API
- [ ] `src/app/post-pool/PostPoolPage.tsx` — フロント UI（画像選択・プレビュー）
- [ ] `lambda/scheduled-autosnsflow/src/post-to-x.ts` — Lambda X投稿処理（メディア対応）
- [ ] `package.json` — `@aws-sdk/client-s3` 依存追加
- [ ] `lambda/scheduled-autosnsflow/package.json` — S3 クライアント依存追加
- [ ] `MEDIA_FEATURE_IMPLEMENTATION.md` — メディア機能ドキュメント
- [ ] `S3_SETUP_GUIDE.md` — S3 セットアップ手順書

### 依存パッケージ

- [ ] フロント側インストール完了
  ```bash
  npm ci
  ```

- [ ] Lambda 側インストール完了
  ```bash
  npm --prefix ./lambda/scheduled-autosnsflow ci
  ```

### 環境変数

- [ ] `.env.local` に以下が設定
  ```env
  S3_MEDIA_BUCKET=autosnsflow-media-xxxxx
  S3_MEDIA_REGION=ap-northeast-1
  ```

- [ ] `.env.production` が本番アカウントで設定（本番デプロイ時）

---

## 🚀 デプロイ手順（段階的）

### 段階 1: AWS インフラセットアップ（一度だけ実行）

```bash
# 1) S3 バケット作成
aws cloudformation deploy \
  --template-file infra/cfn-s3-media.yml \
  --stack-name autosnsflow-media \
  --parameter-overrides MediaRetentionDays=90 \
  --region ap-northeast-1

# 2) バケット名を確認
aws cloudformation describe-stacks \
  --stack-name autosnsflow-media \
  --query 'Stacks[0].Outputs[0].OutputValue' \
  --output text \
  --region ap-northeast-1

# 結果例: autosnsflow-media-123456789012-ap-northeast-1
# → これを .env.local / .env.production に設定
```

### 段階 2: IAM ロール権限設定（一度だけ実行）

Lambda 実行ロールに S3 アクセス権限を付与：

```bash
# ポリシーファイルを作成
cat > /tmp/s3-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::autosnsflow-media-*/*"
    }
  ]
}
EOF

# Lambda ロール名を確認
LAMBDA_ROLE=$(aws lambda get-function-configuration \
  --function-name scheduled-autosnsflow \
  --query 'Role' \
  --output text \
  --region ap-northeast-1 | cut -d'/' -f2)

# ポリシーをアタッチ
aws iam put-role-policy \
  --role-name $LAMBDA_ROLE \
  --policy-name S3MediaAccess \
  --policy-document file:///tmp/s3-policy.json

# クリーンアップ
rm /tmp/s3-policy.json
```

### 段階 3: フロント側ビルド・デプロイ

```bash
# ビルド
npm run build

# デプロイ（Vercel / Amplify / 本番環境に合わせて実行）
# 例: Vercel CLI
vercel deploy --prod

# または Amplify
amplify deploy --yes
```

### 段階 4: Lambda 関数ビルド・デプロイ

```bash
# ディレクトリ移動
cd lambda/scheduled-autosnsflow

# ビルド
npm run build

# パッケージ
npm run zip

# デプロイ（環境変数 $LAMBDA_FUNCTION_NAME が必要）
export LAMBDA_FUNCTION_NAME=scheduled-autosnsflow
npm run deploy
```

---

## ✅ デプロイ後テスト（各段階）

### テスト 1: S3 インフラ確認

```bash
# バケットが存在するか
aws s3 ls | grep autosnsflow-media

# バケットポリシー確認
BUCKET_NAME="autosnsflow-media-123456789012-ap-northeast-1"
aws s3api get-bucket-encryption --bucket "$BUCKET_NAME" --region ap-northeast-1
```

**期待結果：**
- S3 バケットが一覧に表示
- 暗号化が `AES256` に設定

### テスト 2: フロント画像アップロード

**操作手順：**

1. ブラウザで投稿プール画面にアクセス
   ```
   http://localhost:3000/post-pool/general
   ```

2. テスト画像を選択
   - 本文：「テスト投稿 #media」
   - 画像：小さめの JPEG/PNG を選択（1-2 枚）

3. 「登録」ボタンをクリック

**期待結果：**
- ブラウザ console にアップロード進捗表示
- プール一覧に本文と「1個」表示
- S3 バケットに画像ファイルが作成

**確認コマンド：**
```bash
aws s3 ls s3://autosnsflow-media-123456789012-ap-northeast-1/ --recursive --region ap-northeast-1
```

### テスト 3: Lambda 関数テスト

スケジュール投稿で画像付き投稿をテスト：

1. **テストイベント JSON を作成**
   ```json
   {
     "detail": {
       "userId": "test-user-123",
       "accountId": "x-account-123"
     }
   }
   ```

2. **Lambda をテスト実行**
   ```bash
   aws lambda invoke \
     --function-name scheduled-autosnsflow \
     --payload '{"detail":{"userId":"test-user-123","accountId":"x-account-123"}}' \
     /tmp/lambda_response.json \
     --region ap-northeast-1
   
   cat /tmp/lambda_response.json
   ```

**期待結果：**
- CloudWatch Logs に実行ログが記録
- メディア処理ログ（`media uploaded to X` 等）が表示
- エラーなし

### テスト 4: X投稿確認（本番想定）

1. **投稿プールに画像付きで登録**
   - フロント画面で複数画像を選択・登録

2. **スケジュール投稿を作成**
   - 投稿タイミングを設定

3. **定期ワーカーが実行されるのを待つ**（5分ごと）

4. **X タイムラインで確認**
   - 画像が付いて投稿されているか

---

## 🔄 ロールバック手順

万が一の問題時：

### フロント側ロールバック

```bash
# staging ブランチに戻す
git -C "\\wsl.localhost\Ubuntu\home\revival\projects\AutoSNSFlow\frontend" checkout staging

git -C "\\wsl.localhost\Ubuntu\home\revival\projects\AutoSNSFlow\frontend" reset --hard origin/staging

npm run build
```

### Lambda 側ロールバック

```bash
# Lambda コンソール または CLI で前のバージョンへ
aws lambda update-function-code \
  --function-name scheduled-autosnsflow \
  --s3-bucket deployment-bucket \
  --s3-key previous-bundle.zip \
  --region ap-northeast-1
```

### S3 削除（リセット）

```bash
# CloudFormation スタック削除（開発環境のみ）
aws cloudformation delete-stack \
  --stack-name autosnsflow-media \
  --region ap-northeast-1
```

---

## 📊 パフォーマンス・負荷テスト（推奨）

本番運用前に確認：

### テスト条件

- **並行ユーザー**: 10
- **画像数**: 4 枚/ユーザ
- **ファイルサイズ**: 各 5-10 MB
- **期間**: 5 分間

### テストコマンド例（Apache JMeter 推奨）

```bash
# JMeter で負荷テスト実行
jmeter -n -t load_test.jmx -l results.jtl -j jmeter.log
```

### 監視項目

- [ ] API レスポンスタイム < 5秒
- [ ] S3 Upload 成功率 > 99%
- [ ] Lambda 実行時間 < 30秒
- [ ] CloudWatch Logs にエラー < 0.1%

---

## 📝 本番運用前チェック

- [ ] 機密情報（APIキー等）がコミットされていないか確認
  ```bash
  git -C "\\wsl.localhost\Ubuntu\home\revival\projects\AutoSNSFlow\frontend" log --all -S "AKIA" --oneline
  ```

- [ ] `.env.production` に本番 S3 バケット名が設定

- [ ] Lambda IAM ロール権限が最小限（不要な権限なし）

- [ ] CloudWatch Alarms が設定（エラー監視）

- [ ] バックアップ・復旧手順が確認済み

- [ ] チーム全体で デプロイ手順が共有済み

---

## 🚨 緊急対応

### S3 ストレージ満杯時

```bash
# ファイル数・容量確認
aws s3api list-objects-v2 \
  --bucket autosnsflow-media-123456789012-ap-northeast-1 \
  --query '[Contents[].Size] | sum(@)' \
  --region ap-northeast-1

# 古いファイルを削除
aws s3 rm s3://autosnsflow-media-123456789012-ap-northeast-1/media/ \
  --recursive \
  --exclude "*" \
  --include "media/user-*/*" \
  --region ap-northeast-1 \
  --query 'Deleted[?LastModified<=`2024-10-01`]'
```

### Lambda 実行タイムアウト

S3 ダウンロード遅延の場合：

1. Lambda タイムアウト時間を延長
2. S3 アクセスポイント活用
3. CloudFront キャッシュを検討

### X API レート制限

X API へのメディアアップロード回数制限時：

```bash
# Lambda 内で指数バックオフを実装
# 詳細は post-to-x.ts の uploadMediaToX 関数を参照
```

---

## ✨ まとめ

1. **AWS インフラ** → CloudFormation で一度だけデプロイ
2. **IAM 権限** → Lambda ロール にS3 アクセス追加
3. **フロント** → ビルド・デプロイ（Vercel/Amplify）
4. **Lambda** → ビルド・パッケージ・デプロイ
5. **テスト** → 画像選択→ S3→X投稿の全フロー確認
6. **監視** → CloudWatch Logs・Alarms で継続監視

すべてのステップが完了すれば、本番運用開始可能です！

