// /src/pages/api/accounts.ts
// [ADD] ユーザー配下の投稿アカウントを返却（予約モーダルのドロップダウン用）
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS || "ThreadsAccounts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    const out = await ddb.send(new QueryCommand({
      TableName: TBL,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: "ACCOUNT#" },
      },
      ProjectionExpression: "SK, displayName",
      ScanIndexForward: true,
      Limit: 200,
    }));
    const accounts = (out.Items || []).map(it => ({
      accountId: String(it.SK?.S || "").replace("ACCOUNT#", ""),
      displayName: it.displayName?.S || "",
    }));
    res.status(200).json({ accounts });
  } catch (e: any) {
    res.status(e?.statusCode === 401 ? 401 : 500).json({ error: e?.message || "internal_error" });
  }
}
