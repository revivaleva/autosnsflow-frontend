# S3 メディアストレージ 連携・準備ガイド

このドキュメントでは、X投稿へのメディア（画像・動画）対応のための S3 インフラストラクチャの準備手順を詳しく説明します。

---

## 📋 概要

AutoSNSFlow のメディア機能は以下の構成で動作します：

```
【ユーザー操作】
フロント画面で画像選択
  ↓
【フロント処理】
Base64 変換 → API送信（/api/post-pool/upload-media）
  ↓
【バックエンド処理】
S3 へアップロード → URL 返却 → プール保存
  ↓
【定期実行（Lambda）】
投稿時に S3 から画像ダウンロード
  ↓
【X API】
X v1.1 で メディアアップロード → X v2 で投稿
```

---

## 🔧 準備手順（段階的）

### 前提条件の確認

必要なツール・権限：

- ✅ AWS CLI v2 がインストール済み（`aws --version` で確認）
- ✅ IAM ユーザーが以下の権限を持つ
  - CloudFormation：スタック作成・更新・削除
  - S3：バケット作成・ポリシー設定・暗号化
  - IAM：ロール・ポリシー作成（Lambda 実行ロール用）

⚠️ **セキュリティ注意**: 本ガイドでは一時的にフルアクセス権限を使用しています。セットアップ完了後は、以下の**最小限権限に変更することを強く推奨**します：
- `cloudformation:CreateStack`, `UpdateStack`, `DescribeStacks`
- `s3:GetObject`, `s3:DeleteObject`（Lambda が必要とするアクション）
- `iam:PutRolePolicy`（ロール権限更新時のみ）

詳細は本ガイドの最後の「🔐 セキュリティ：最小限権限への変更」を参照。

AWS 認証情報を設定済み：

```bash
aws sts get-caller-identity
```

出力されたら OK。ユーザー ID・アカウント ID・ARN が表示されます。

---

### STEP 1: CloudFormation スタックのデプロイ

#### 1-1. テンプレートの確認

`infra/cfn-s3-media.yml` を確認：

```bash
cat infra/cfn-s3-media.yml | head -30
```

出力例：
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: S3 bucket for media uploads (images and videos) for AutoSNSFlow
Parameters:
  MediaRetentionDays:
    Type: Number
    Default: 90
    Description: Days to retain media files before deletion (0 = never delete)
```

#### 1-2. CloudFormation で S3 バケットを作成

```bash
aws cloudformation deploy \
  --template-file infra/cfn-s3-media.yml \
  --stack-name autosnsflow-media \
  --parameter-overrides MediaRetentionDays=90 \
  --region ap-northeast-1
```

実行すると以下のような出力が表示されます：

```
Waiting for changeset to be created..
Waiting for stack autosnsflow-media to be created
Stack autosnsflow-media has been successfully created
```

### ⏱️ 所要時間: 1-2 分

#### 1-3. デプロイ結果の確認

スタックが正常に作成されたか確認：

```bash
aws cloudformation describe-stacks \
  --stack-name autosnsflow-media \
  --region ap-northeast-1
```

出力を確認（`StackStatus` が `CREATE_COMPLETE` であること）：

```json
{
  "Stacks": [
    {
      "StackName": "autosnsflow-media",
      "StackStatus": "CREATE_COMPLETE",
      ...
    }
  ]
}
```

---

### STEP 2: S3 バケット情報の取得

#### 2-1. バケット名を確認

CloudFormation の Outputs から S3 バケット名を取得：

```bash
aws cloudformation describe-stacks \
  --stack-name autosnsflow-media \
  --query 'Stacks[0].Outputs[?OutputKey==`MediaBucketName`].OutputValue' \
  --output text \
  --region ap-northeast-1
```

出力例：
```
autosnsflow-media-123456789-ap-northeast-1
```

このバケット名をコピーして、後の手順で使用します。

#### 2-2. バケットの設定確認

バケットのポリシーと設定が正しく適用されているか確認：

```bash
BUCKET_NAME="autosnsflow-media-123456789-ap-northeast-1"

# 暗号化設定確認
aws s3api get-bucket-encryption --bucket "$BUCKET_NAME" --region ap-northeast-1
```

出力例：
```json
{
  "Rules": [
    {
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }
  ]
}
```

#### 2-3. バージョニング設定の確認

```bash
aws s3api get-bucket-versioning --bucket "$BUCKET_NAME" --region ap-northeast-1
```

出力例：
```json
{
  "Status": "Enabled"
}
```

---

### STEP 3: IAM 権限設定（Lambda 実行ロール）

Lambda 関数が S3 にアクセスするには、IAM ロールに適切なポリシーが必要です。

#### 3-1. 現在の Lambda 実行ロールを確認

```bash
aws lambda get-function-configuration \
  --function-name scheduled-autosnsflow \
  --query 'Role' \
  --region ap-northeast-1
```

出力例：
```
arn:aws:iam::123456789012:role/lambda-autosnsflow-role
```

ロール名をコピーしておきます（例：`lambda-autosnsflow-role`）。

#### 3-2. 既存ポリシーを確認

```bash
aws iam list-role-policies \
  --role-name lambda-autosnsflow-role
```

出力例：
```json
{
  "PolicyNames": [
    "DynamoDBAccess",
    "CloudWatchLogsAccess"
  ]
}
```

#### 3-3. S3 アクセスポリシーを追加

以下のポリシーを作成して Lambda ロールにアタッチします。

`/tmp/s3-policy.json` を作成：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::autosnsflow-media-*/*"
    }
  ]
}
```

ポリシーをアタッチ：

```bash
aws iam put-role-policy \
  --role-name lambda-autosnsflow-role \
  --policy-name S3MediaAccess \
  --policy-document file:///tmp/s3-policy.json
```

確認：

```bash
aws iam get-role-policy \
  --role-name lambda-autosnsflow-role \
  --policy-name S3MediaAccess
```

---

### STEP 4: 環境変数の設定

#### 4-1. `.env.local` を作成/更新

プロジェクトルートで `.env.local` を作成（存在する場合は追記）：

```bash
cat >> .env.local << 'EOF'

# S3 Media Storage
S3_MEDIA_BUCKET=autosnsflow-media-123456789-ap-northeast-1
S3_MEDIA_REGION=ap-northeast-1
EOF
```

**注意：** `autosnsflow-media-123456789-ap-northeast-1` は前のステップで確認したバケット名に置き換え。

#### 4-2. `.env.production` を設定（本番デプロイ時）

本番環境では AWS Secrets Manager や Amplify の環境変数で設定します。確認：

```bash
# これはローカルのみ確認（本番は別途デプロイパイプラインで設定）
echo $S3_MEDIA_BUCKET
```

---

### STEP 5: 依存パッケージのインストール

フロント・Lambda 両方で S3 SDK を使用するため、依存パッケージをインストール：

#### 5-1. フロント側

```bash
npm install
```

`package.json` に `@aws-sdk/client-s3` が追加されていることを確認：

```bash
npm list @aws-sdk/client-s3
```

#### 5-2. Lambda 側

```bash
npm --prefix ./lambda/scheduled-autosnsflow install
```

確認：

```bash
npm --prefix ./lambda/scheduled-autosnsflow list @aws-sdk/client-s3
```

---

### STEP 6: ローカル動作確認

#### 6-1. フロント開発サーバ起動

```bash
npm run dev
```

起動完了を待ちます（http://localhost:3000 でアクセス可能）。

#### 6-2. 投稿プール画面で画像選択テスト

ブラウザで投稿プール画面にアクセス：

```
http://localhost:3000/post-pool/general
```

操作手順：
1. **投稿本文**を入力
2. **「画像（最大4枚）」ボタン**をクリック
3. ローカルマシンの画像ファイルを選択（JPEG/PNG 推奨）
4. **プレビュー**に画像が表示されることを確認
5. **「登録」ボタン**をクリック

**期待される挙動：**
- ブラウザ console でアップロード進捗が表示
- 完了後 プール一覧に本文と「1個」と表示
- CloudWatch Logs に `/api/post-pool/upload-media` のログが記録

#### 6-3. S3 バケットへのアップロード確認

```bash
aws s3 ls s3://autosnsflow-media-123456789-ap-northeast-1/ --recursive --region ap-northeast-1
```

出力例：
```
2024-12-02 14:23:45       45678 media/user-123/1702000000000-abc12345.jpg
```

ファイルが存在すれば成功。

---

### STEP 7: Lambda 関数のビルド・デプロイ

#### 7-1. Lambda 関数をビルド

```bash
cd lambda/scheduled-autosnsflow
npm run build
```

完了を確認：

```bash
ls -lh dist/handler.js
```

#### 7-2. Lambda 関数をパッケージ

```bash
npm run zip
```

確認：

```bash
ls -lh bundle.zip
```

#### 7-3. Lambda 関数をデプロイ

```bash
npm run deploy
```

実行には AWS CLI の認証と、環境変数 `$LAMBDA_FUNCTION_NAME` が必要です。不明な場合は AWS Management Console で関数名を確認してください。

---

## ✅ 検証チェックリスト

デプロイ完了後、以下を確認してください：

- [ ] CloudFormation スタック `autosnsflow-media` が `CREATE_COMPLETE` 状態
- [ ] S3 バケット `autosnsflow-media-*` が存在
- [ ] バケットの暗号化が `AES256` に設定
- [ ] Lambda 実行ロールに `S3MediaAccess` ポリシーがアタッチされている
- [ ] `.env.local` に `S3_MEDIA_BUCKET` と `S3_MEDIA_REGION` が設定
- [ ] `npm install` / `npm --prefix ./lambda/scheduled-autosnsflow install` が完了
- [ ] ローカル開発サーバで画像アップロードが成功
- [ ] S3 バケットにアップロードされたファイルが確認可能

---

## 🐛 トラブルシューティング

### Q: CloudFormation デプロイが失敗

**エラーメッセージ例：** `An error occurred (ValidationError): Template format error: ...`

**原因・対処：**
1. テンプレートファイルの YAML 構文を確認
   ```bash
   aws cloudformation validate-template --template-body file://infra/cfn-s3-media.yml
   ```
2. インデント等の構文エラーがあれば修正

### Q: 「Access Denied」で S3 にアップロードできない

**エラーメッセージ例：** `PUT /api/post-pool/upload-media 403 Forbidden`

**原因・対処：**
1. AWS 認証情報を確認
   ```bash
   aws sts get-caller-identity
   ```
2. IAM ユーザーが `S3FullAccess` または上記の S3 ポリシーを持つか確認
3. 別の AWS アカウント設定が有効になっていないか確認
   ```bash
   cat ~/.aws/config
   ```

### Q: ローカル開発で `S3_MEDIA_BUCKET` が未設定エラー

**エラーメッセージ例：** `Error: s3_bucket_not_configured`

**原因・対処：**
1. `.env.local` が存在するか確認
   ```bash
   cat .env.local | grep S3_MEDIA_BUCKET
   ```
2. 設定値が正しいか確認（バケット名にタイポがないか）
3. npm 開発サーバを再起動

### Q: Lambda のビルド/デプロイが失敗

**エラーメッセージ例：** `npm ERR! code EACCES`

**原因・対処：**
1. 依存パッケージを再インストール
   ```bash
   npm --prefix ./lambda/scheduled-autosnsflow ci --force
   ```
2. Node.js のバージョン確認（20+ 必須）
   ```bash
   node --version
   ```

---

## 📞 その他の問題

上記で解決しない場合は、以下を確認して報告ください：

1. **CloudWatch Logs**
   ```bash
   aws logs tail /aws/lambda/scheduled-autosnsflow --follow
   ```

2. **S3 バケットのアクセスログ**
   ```bash
   aws s3api get-bucket-logging --bucket autosnsflow-media-*
   ```

3. **Lambda 実行ロールのポリシー**
   ```bash
   aws iam get-role-policy --role-name lambda-autosnsflow-role --policy-name S3MediaAccess
   ```

---

## 🔄 その他の操作

### S3 バケットの削除

デプロイを取り消す場合：

```bash
aws cloudformation delete-stack --stack-name autosnsflow-media --region ap-northeast-1
```

スタック削除は 1-2 分かかります。確認：

```bash
aws cloudformation describe-stacks --stack-name autosnsflow-media --region ap-northeast-1
```

`DELETE_COMPLETE` となれば完了。

### メディア保持期間の変更

ライフサイクル設定を更新：

```bash
aws cloudformation update-stack \
  --stack-name autosnsflow-media \
  --template-body file://infra/cfn-s3-media.yml \
  --parameter-overrides MediaRetentionDays=180 \
  --region ap-northeast-1
```

### バケット内のファイル一覧・削除

ローカルから S3 ファイルを管理：

```bash
# 一覧表示
aws s3 ls s3://autosnsflow-media-*/ --recursive

# ファイル削除
aws s3 rm s3://autosnsflow-media-*/media/user-123/1702000000000-abc12345.jpg
```

---

## 🔐 セキュリティ：最小限権限への変更（セットアップ完了後に実施）

本ガイドではセットアップ時に一時的にフルアクセス権限を使用しています。セットアップ完了後は、以下の最小限権限に変更することを**強く推奨**します。

### 最小限権限ポリシー

AWS Management Console で IAM ユーザーのポリシーを以下に変更：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationMinimal",
      "Effect": "Allow",
      "Action": [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:ListStacks"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3MinimalForLambda",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::autosnsflow-media-*",
        "arn:aws:s3:::autosnsflow-media-*/media/*"
      ]
    }
  ]
}
```

### 実行ステップ

1. **AWS Management Console** にアクセス
2. **IAM** → **ユーザー** → `autosnsflow-prod-app` を選択
3. **ポリシーをアタッチ** のセクションで
   - 既存の CloudFormation/S3 フルアクセスを **削除**
   - 上記の最小限ポリシーを **新規作成・アタッチ**

### 検証

ポリシー変更後、以下が実行可能か確認：

```bash
# OK: S3 バケット一覧確認
aws s3 ls

# OK: CloudFormation スタック確認
aws cloudformation describe-stacks --stack-name autosnsflow-media --region ap-northeast-1

# 失敗するはず: 新規スタック作成（権限なし）
aws cloudformation create-stack --stack-name test-stack --template-body '{}' --region ap-northeast-1
```

---

## 📚 参考リンク

- [AWS CloudFormation ドキュメント](https://docs.aws.amazon.com/cloudformation/)
- [AWS S3 ドキュメント](https://docs.aws.amazon.com/s3/)
- [AWS IAM 最小限権限の原則](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#grant-least-privilege)
- [AWS SDK for JavaScript - S3](https://docs.aws.amazon.com/sdk-for-javascript/latest/developer-guide/s3-examples.html)
- [X API v1.1 Media Upload](https://developer.twitter.com/en/docs/twitter-api/v1-1/tweets/upload-media/overview)

