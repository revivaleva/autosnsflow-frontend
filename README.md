# AutoSNSFlow - SNS自動投稿管理システム

高度なAI生成機能とマルチアカウント対応の SNS 自動投稿・スケジューリングプラットフォーム。

現在対応: **Threads** ・ **X（旧Twitter）**

## 主要機能

- **投稿プール管理**：テキスト・画像を事前登録し、スケジュールに沿って自動投稿
- **AI投稿生成**：OpenAI 統合で自動文案生成（テーマ・ペルソナ設定可）
- **マルチアカウント対応**：Threads・X それぞれ複数アカウント管理
- **メディア対応**：S3 連携による画像・動画の投稿プール登録と自動投稿
- **予約投稿**：詳細な時間帯設定・再利用オプション付き
- **リプライ自動化**：投稿への自動リプライ返信フロー

## 最新実装（2024年12月）

### ✅ X投稿メディア対応

画像・動画を投稿プールに登録し、X への自動投稿時に添付できるようになりました。

**実装内容：**
- **S3 インフラ**：CloudFormation テンプレート（`infra/cfn-s3-media.yml`）でバケット自動作成
- **アップロードAPI**：`/api/post-pool/upload-media`でBase64画像を S3 に保存
- **フロント UI**：投稿プール画面で最大4つの画像選択・プレビュー表示
- **Lambda統合**：スケジュール投稿時に S3 ↔ X API v1.1 でメディア処理
- **再利用設定**：プール設定で投稿後の S3 自動削除をON/OFF

詳細は [`MEDIA_FEATURE_IMPLEMENTATION.md`](MEDIA_FEATURE_IMPLEMENTATION.md) を参照。

---

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

---

## ⚙️ セットアップ手順

### 前提条件

- Node.js 20+
- AWS CLI v2（ローカル開発用）
- WSL 2 + Ubuntu（Windows環境の場合）

### 1. 依存パッケージのインストール

```bash
npm ci
npm --prefix ./lambda/scheduled-autosnsflow ci
npm --prefix ./packages/shared ci
npm --prefix ./packages/backend-core ci
```

### 2. 環境変数の設定

`.env.local` ファイルを作成し、以下を設定：

```env
# AWS
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
AWS_REGION=ap-northeast-1

# Cognito
NEXT_PUBLIC_COGNITO_USER_POOL_ID=<your-user-pool-id>
NEXT_PUBLIC_COGNITO_CLIENT_ID=<your-client-id>
COGNITO_USER_POOL_ID=<your-user-pool-id>

# S3 Media（画像・動画用）
S3_MEDIA_BUCKET=autosnsflow-media-xxxxxx
S3_MEDIA_REGION=ap-northeast-1

# AWS Credentials（サーバ側のみ）
AUTOSNSFLOW_ACCESS_KEY_ID=<your-access-key>
AUTOSNSFLOW_SECRET_ACCESS_KEY=<your-secret-key>

# DynamoDB Tables
TBL_POST_POOL=PostPool
TBL_X_SCHEDULED=XScheduledPosts
TBL_USER_TYPE_TIME_SETTINGS=UserTypeTimeSettings
```

### 3. S3 インフラのセットアップ

メディア機能を使用する場合は CloudFormation で S3 バケットを作成：

```bash
aws cloudformation deploy \
  --template-file infra/cfn-s3-media.yml \
  --stack-name autosnsflow-media \
  --parameter-overrides MediaRetentionDays=90 \
  --region ap-northeast-1
```

**デプロイ後：**
```bash
# バケット名を確認
aws cloudformation describe-stacks \
  --stack-name autosnsflow-media \
  --query 'Stacks[0].Outputs[0].OutputValue' \
  --region ap-northeast-1
```

確認したバケット名を `.env.local` の `S3_MEDIA_BUCKET` に設定。

### 4. ローカル開発サーバ起動

```bash
npm run dev
```

http://localhost:3000 でアクセス可能。

### 5. Lambda 関数のビルド・デプロイ

定期実行ワーカーの修正時：

```bash
cd lambda/scheduled-autosnsflow

npm run build

npm run zip

npm run deploy
```

---

## 📚 ドキュメント

- [`MEDIA_FEATURE_IMPLEMENTATION.md`](MEDIA_FEATURE_IMPLEMENTATION.md) — メディア機能の実装ガイド・API仕様
- [`infrastructure/README.md`](infrastructure/README.md) — インフラ設定・DynamoDB スキーマ
- [`pjspec.mdc`](.cursor/rules/pjspec.mdc) — プロジェクト仕様書（カーソルルール）

---

## 🔐 セキュリティに関する注意

- **APIキー・トークンのコミット禁止**：`.env.*` は `.gitignore` で管理
- **S3 バケット**：デフォルトでパブリックアクセスをブロック
- **認証**：Cognito を使用、全API呼び出しは認証必須

---

## 📋 ブランチ運用

### 基本方針

**ローカルでの編集は常に`staging`ブランチで行います。**

リモートへ反映する際の手順：
1. まず`staging`ブランチにpush
2. 必要に応じて`lambda`や`main`ブランチにマージ

### ブランチの役割

- `staging`：通常の開発・修正ブランチ（デフォルト）。ローカルでの編集は常にこのブランチで行う
- `lambda`：定期実行関連の変更を反映。`staging`からマージしてpushすると自動ビルドが実行される
- `main`：本番環境。直接 push 禁止、明示指示時のみマージ

---

## This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
