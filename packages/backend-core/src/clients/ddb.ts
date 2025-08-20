// /packages/backend-core/src/clients/ddb.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { REGION } from "../config";

// シングルトンDDBクライアント
export const ddb = new DynamoDBClient({ region: REGION });
