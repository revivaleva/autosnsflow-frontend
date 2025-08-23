// /packages/backend-core/src/clients/ddb.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { REGION } from "../config";

// シングルトンDDBクライアント（フロントエンドと同じ認証設定）
export const ddb = new DynamoDBClient({
  region: REGION,
  credentials: process.env.AUTOSNSFLOW_ACCESS_KEY_ID && process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID,
        secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY,
      }
    : undefined, // undefined の場合はデフォルト認証チェーンを使用
});
