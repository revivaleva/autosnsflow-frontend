# S3 セットアップ完了 - テスト開始ガイド

## ✅ セットアップ完了

すべての AWS インフラストラクチャ・IAM 権限設定が完了しました！

---

## 📋 セットアップ完了項目

| 項目 | 状態 | 詳細 |
|------|------|------|
| **S3 バケット作成** | ✅ | `autosnsflow-media-autosnsflow-media-605822313174` |
| **CloudFormation テンプレート** | ✅ | 暗号化・ライフサイクル・ポリシー設定済み |
| **環境変数設定** | ✅ | `.env.local` に S3_MEDIA_BUCKET 設定 |
| **npm インストール** | ✅ | フロント・Lambda 依存パッケージ完了 |
| **Lambda IAM 権限** | ✅ | S3GetObject・S3DeleteObject 権限付与 |

---

## 🚀 ローカル開発テスト手順

### STEP 1: 開発サーバ起動

```bash
cd /home/revival/projects/AutoSNSFlow/frontend

npm run dev
```

**期待される出力:**
```
▲ Next.js 14.x.x
- ready started server on 0.0.0.0:3000, url: http://localhost:3000
```

起動後、ブラウザで `http://localhost:3000` にアクセス可能。

### STEP 2: 画像アップロードテスト

1. **ログイン**
   - 管理画面にアクセス

2. **投稿プール画面へ**
   ```
   http://localhost:3000/post-pool/general
   ```

3. **テスト投稿作成**
   - **本文**: テストメッセージを入力（例：「テスト投稿 #media」）
   - **画像**: 「画像（最大4枚）」ボタンをクリック
   - **ファイル選択**: ローカルから JPEG/PNG を選択（1-2 ファイル推奨）
   - **プレビュー確認**: 選択した画像が表示されることを確認

4. **「登録」ボタン**をクリック

**期待される挙動:**
- ブラウザ Console に `[post-pool] uploaded 1 media files` のようなログ表示
- API レスポンス確認: `PUT /api/post-pool/upload-media 200 OK`
- プール一覧に本文が表示される
- 「1個」という画像数が表示される

### STEP 3: S3 ファイル確認

別ターミナルで以下を実行：

```bash
aws s3 ls s3://autosnsflow-media-autosnsflow-media-605822313174/ --recursive --region ap-northeast-1
```

**期待される出力例:**
```
2025-12-03 10:15:30       12345 media/user-123/1702612530000-abc12345.jpg
```

ファイルがあれば **S3 アップロード成功！** ✅

### STEP 4: CloudWatch Logs 確認（オプション）

```bash
aws logs tail /aws/lambda/scheduled-autosnsflow --follow --region ap-northeast-1
```

---

## 🧪 Lambda ビルド・テスト（次ステップ）

### 前提条件

- S3 アップロード成功を確認後に実行

### ビルド

```bash
cd lambda/scheduled-autosnsflow

npm run build
```

### パッケージ作成

```bash
npm run zip
```

### デプロイ

```bash
npm run deploy
```

---

## 📝 検証チェックリスト

ローカルテスト完了後、以下で確認してください：

### フロント側

- [ ] `npm run dev` で開発サーバが起動
- [ ] http://localhost:3000 でアクセス可能
- [ ] 投稿プール画面で画像選択可能
- [ ] 「登録」でアップロード成功
- [ ] S3 にファイルが作成される
- [ ] プール一覧に画像数が表示される

### Lambda 側（デプロイ後）

- [ ] Lambda 関数が正常にビルド
- [ ] `npm run deploy` でデプロイ成功
- [ ] CloudWatch Logs でメディア処理ログ確認可能

### 統合テスト（投稿まで）

- [ ] 投稿プール → 予約投稿
- [ ] Lambda 5分ジョブ実行
- [ ] X タイムラインで画像付き投稿確認

---

## 🆘 トラブルシューティング

### Q: 「ブラウザ Console にエラーが表示される」

**対処:**
1. Network タブを開く
2. `/api/post-pool/upload-media` リクエストを確認
3. Response タブでエラーメッセージ確認
4. 本ガイドの「S3 セットアップガイド」トラブルシューティング参照

### Q: 「S3 にファイルが作成されない」

**確認項目:**
1. `.env.local` に `S3_MEDIA_BUCKET` が設定されているか
   ```bash
   grep S3_MEDIA_BUCKET .env.local
   ```
2. AWS 認証情報が正しいか
   ```bash
   aws sts get-caller-identity
   ```
3. 開発サーバを再起動（環境変数反映）
   ```bash
   npm run dev
   ```

### Q: 「CloudWatch に Lambda ログが表示されない」

**確認:**
- Lambda 実行ロール `scheduled-autosnsflow-exec` に `logs:*` 権限があるか確認
- CloudWatch Logs グループ `/aws/lambda/scheduled-autosnsflow` が存在するか

---

## 📞 次のサポート

各ドキュメントを参照：

- **セットアップ詳細**: `S3_SETUP_GUIDE.md`
- **デプロイ・テスト**: `DEPLOYMENT_CHECKLIST.md`
- **API 仕様**: `MEDIA_FEATURE_IMPLEMENTATION.md`
- **機能概要**: `IMPLEMENTATION_SUMMARY.md`

---

## ✨ まとめ

🎉 **S3 メディア機能のセットアップが完全に完了しました！**

次は **ローカルテスト** を実行してください：

```bash
# 1. 開発サーバ起動
npm run dev

# 2. ブラウザで http://localhost:3000 アクセス
# 3. 投稿プール画面で画像アップロード
# 4. S3 にファイル作成を確認
```

すべてが成功したら、Lambda デプロイ → 統合テスト → 本番デプロイ の流れで完成です！🚀


