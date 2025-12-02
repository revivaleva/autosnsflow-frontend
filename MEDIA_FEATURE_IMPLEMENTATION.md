# X 投稿へのメディア（画像・動画）対応 実装ガイド

## 概要

投稿プールから登録した画像・動画を X に投稿する機能を実装しました。以下は段階的な実装内容です。

---

## 実装済み項目

### 1. S3 インフラストラクチャ（`infra/cfn-s3-media.yml`）

- **S3 バケット作成**
  - バケット名：`${StackName}-autosnsflow-media-${AccountId}`
  - 暗号化：AES256（必須）
  - パブリックアクセス：ブロック
  - ライフサイクル：`MediaRetentionDays` パラメータで削除スケジュール設定可

**デプロイ方法**
```bash
aws cloudformation deploy \
  --template-file infra/cfn-s3-media.yml \
  --stack-name autosnsflow-media \
  --parameter-overrides MediaRetentionDays=90
```

### 2. 環境変数設定（`src/lib/env.ts`）

追加した設定：
- `S3_MEDIA_BUCKET`：S3 バケット名
- `S3_MEDIA_REGION`：AWS リージョン（デフォルト：`AWS_REGION`）

**.env ファイルに追加**
```env
S3_MEDIA_BUCKET=autosnsflow-media-xxxxx
S3_MEDIA_REGION=ap-northeast-1
```

### 3. メディアアップロード API（`src/pages/api/post-pool/upload-media.ts`）

**機能：**
- Base64 エンコードされた画像ファイルを受け取り S3 に保存
- 最大 4 ファイル、最大 25 MB/ファイル
- 対応形式：JPEG, PNG, GIF, WebP

**エンドポイント：** `POST /api/post-pool/upload-media`

**リクエスト例**
```json
{
  "files": [
    {
      "data": "data:image/jpeg;base64,/9j/4AAQSkZJ...",
      "type": "image/jpeg",
      "name": "photo.jpg"
    }
  ]
}
```

**レスポンス例**
```json
{
  "ok": true,
  "urls": [
    "s3://autosnsflow-media-xxxxx/media/user123/1702000000-abc12345.jpg"
  ],
  "errors": []
}
```

### 4. フロントエンド投稿プール画面（`src/app/post-pool/PostPoolPage.tsx`）

**追加機能：**
- 画像選択UI（最大4枚）
- 画像プレビュー表示
- プレビューからの削除ボタン
- 投稿登録時にメディアをS3にアップロード
- プール一覧に画像数表示

**フロー：**
1. ユーザーが画像ファイルを選択
2. プレビュー表示
3. 「登録」ボタン押下
4. Base64 変換 → `/api/post-pool/upload-media` に POST
5. S3 URL を取得 → `/api/post-pool` に POST
6. プール保存完了

### 5. Lambda メディア処理（`lambda/scheduled-autosnsflow/src/post-to-x.ts`）

**追加機能：**

#### A. S3 からメディアダウンロード
```typescript
getMediaFromS3(s3Url: string): Promise<Buffer>
```

#### B. X API v2 へのメディアアップロード
```typescript
uploadMediaToX(accessToken: string, mediaBuffer: Buffer, mediaType: string): Promise<string>
```
- Twitter v1.1 `/media/upload.json` エンドポイントを使用
- `media_id_string` を取得

#### C. S3 からメディア削除
```typescript
deleteMediaFromS3(s3Url: string): Promise<void>
```

#### D. 拡張 `postToX()` 関数
```typescript
postToX({
  accessToken: string,
  text: string,
  mediaUrls?: string[]  // 新規追加
}): Promise<void>
```

**メディア処理フロー：**
1. 投稿プールから画像 URL を取得
2. S3 からダウンロード
3. X API v1.1 `media/upload` で ID を取得
4. X API v2 `tweets` で `media.media_ids` を指定して投稿
5. 投稿成功後、再利用設定に基づいて S3 から削除

### 6. 再利用設定に基づく削除ロジック

**設定値の確認**
- `UserTypeTimeSettings` テーブルの `reuse` フィールドを確認
- `reuse = true`：メディア保持（再利用可）
- `reuse = false`：メディア削除（投稿後削除）

**実装位置**
- `postFromPoolForAccount()` 関数内で投稿成功後に実行

---

## 依存パッケージ追加

### フロント側（`package.json`）
```json
"@aws-sdk/client-s3": "^3.859.0"
```

### Lambda 側（`lambda/scheduled-autosnsflow/package.json`）
```json
"@aws-sdk/client-s3": "^3.0.0",
"@aws-sdk/util-stream-node": "^3.0.0"
```

---

## デプロイ手順

### 1. 依存パッケージをインストール
```bash
npm install
npm --prefix ./lambda/scheduled-autosnsflow install
```

### 2. S3 インフラをデプロイ
```bash
aws cloudformation deploy \
  --template-file infra/cfn-s3-media.yml \
  --stack-name autosnsflow-media \
  --parameter-overrides MediaRetentionDays=90
```

### 3. Lambda 関数をビルド・デプロイ
```bash
cd lambda/scheduled-autosnsflow
npm run build
npm run zip
npm run deploy
```

### 4. フロント側をデプロイ
```bash
npm run build
npm run start
```

---

## テスト手順

### 1. フロント側：画像選択＆登録
1. 管理画面から「投稿プール」を選択
2. 「投稿本文」を入力
3. 「画像」ボタンで最大4つの画像を選択
4. プレビュー確認
5. 「登録」ボタンをクリック
6. アップロード進行状況を確認

### 2. Lambda側：スケジュール投稿実行
1. X アカウントが自動投稿有効に設定されていることを確認
2. スケジュール投稿が生成されていることを確認
3. Lambda 実行時間に到達するか、手動でテストイベント実行
4. CloudWatch Logs で実行ログを確認

### 3. X での確認
- X アカウントのタイムラインで画像付き投稿を確認

---

## 制限事項と今後の改善

### 現在の実装
- **対応形式：** 画像のみ（JPEG, PNG, GIF, WebP）
- **最大ファイル数：** 4 個（X の制限）
- **最大ファイルサイズ：** 25 MB/ファイル

### 動画対応（次ステップ）
- 動画形式：MP4 等の追加対応
- 動画アップロード API の拡張
- X v1.1 メディアアップロード時の動画フォーマット対応

### エラーハンドリング
- S3 ダウンロード失敗時：投稿をスキップせず、テキストのみで投稿
- X API メディアアップロード失敗時：同様にスキップ
- ※ 改善予定：リトライロジック、エラーログ詳細化

---

## API 仕様書

### POST /api/post-pool/upload-media

**認証：** 必須（Cognito ユーザー認証）

**リクエスト:**
```typescript
{
  files: Array<{
    data: string;      // Base64 encoded data (data:image/...;base64,...)
    type: string;      // MIME type (image/jpeg, image/png, etc.)
    name: string;      // Original filename
  }>
}
```

**レスポンス（200 OK）:**
```typescript
{
  ok: true,
  urls: string[],     // s3://bucket/key format
  errors?: Array<{
    file: string;
    error: string;
  }>
}
```

**エラーレスポンス:**
- `400 Bad Request`：ファイル数超過、無効なタイプ
- `401 Unauthorized`：認証なし
- `500 Internal Server Error`：S3 アップロード失敗

---

## トラブルシューティング

### 画像が投稿されない場合
1. **S3 バケットの確認**
   ```bash
   aws s3 ls s3://autosnsflow-media-xxxxx/media/
   ```
2. **Lambda ログの確認**
   ```bash
   aws logs tail /aws/lambda/your-lambda-function-name --follow
   ```
3. **X API トークンの有効期限確認**

### ファイルアップロード失敗
- ファイルサイズが 25 MB 以下か確認
- ファイル形式が対応形式か確認（JPEG/PNG/GIF/WebP）
- ブラウザの Console でエラーメッセージ確認

### S3 ファイルが削除されない
- `UserTypeTimeSettings` で `reuse` 設定を確認
- 投稿プール設定画面で「プール再利用」の ON/OFF を確認

---

## 参考リンク

- [X API v2 ドキュメント](https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/integrate/create-tweet)
- [X API v1.1 メディア アップロード](https://developer.twitter.com/en/docs/twitter-api/v1-1/tweets/upload-media/overview)
- [AWS S3 ドキュメント](https://docs.aws.amazon.com/s3/)

