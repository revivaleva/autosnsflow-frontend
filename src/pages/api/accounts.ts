// src/pages/api/accounts.ts
// [MOD] 自動投稿グループID(autoPostGroupId)とペルソナ情報を返すよう拡張
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL = "ThreadsAccounts"; // [NOTE] 既存と同名。環境変数なし方針に合わせ固定

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
      // [MOD] persona / autoPostGroupId も取得
      ProjectionExpression: "SK, displayName, autoPostGroupId, personaStatic, personaDynamic",
      ScanIndexForward: true,
      Limit: 200,
    }));
    const accounts = (out.Items || []).map(it => ({
      accountId: String(it.SK?.S || "").replace("ACCOUNT#", ""),
      displayName: it.displayName?.S || "",
      autoPostGroupId: it.autoPostGroupId?.S || "",
      personaStatic: it.personaStatic?.S || "",
      personaDynamic: it.personaDynamic?.S || "",
    }));
    res.status(200).json({ accounts });
  } catch (e: any) {
    res.status(e?.statusCode === 401 ? 401 : 500).json({ error: e?.message || "internal_error" });
  }
}
