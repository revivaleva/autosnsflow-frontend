// /src/lib/ddb.ts
// [ADD] DynamoDBクライアントの生成を統一（固定キーがあれば優先、無ければ実行ロール）
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { env } from "./env";
export function createDynamoClient() {
    if (env.AUTOSNSFLOW_ACCESS_KEY_ID && env.AUTOSNSFLOW_SECRET_ACCESS_KEY) {
        // [ADD] 暫定：固定キー（本番は実行ロール推奨）
        return new DynamoDBClient({
            region: env.AWS_REGION,
            credentials: {
                accessKeyId: env.AUTOSNSFLOW_ACCESS_KEY_ID,
                secretAccessKey: env.AUTOSNSFLOW_SECRET_ACCESS_KEY,
            },
        });
    }
    // [ADD] 実行ロール利用（推奨）
    return new DynamoDBClient({ region: env.AWS_REGION });
}
