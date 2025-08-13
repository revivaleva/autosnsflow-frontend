// /src/pages/api/admin/users.ts
// [MOD] Cookie/Bearer両対応でIdToken検証→admin必須→Dynamo同期
import type { NextApiRequest, NextApiResponse } from "next";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb"; // [ADD]
import { verifyUserFromRequest, assertAdmin } from "@/lib/auth"; // [ADD]
import { env } from "@/lib/env"; // [ADD]

const ddb = createDynamoClient();
const cipa = new CognitoIdentityProviderClient({ region: env.AWS_REGION });
const USER_POOL_ID = env.COGNITO_USER_POOL_ID;
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

function todayKeyJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req); // [ADD]
    assertAdmin(user);                              // [ADD]

    const usersResp = await cipa.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }));
    const list = usersResp.Users || [];
    const results: any[] = [];

    for (const u of list) {
      const sub = u.Attributes?.find(a => a?.Name === "sub")?.Value || "";
      const email = u.Attributes?.find(a => a?.Name === "email")?.Value || "";
      if (!sub) continue;

      const pk = { S: `USER#${sub}` };
      const sk = { S: "SETTINGS" };

      // 初期化 or 取得
      const got = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: pk, SK: sk } }));
      if (!got.Item) {
        await ddb.send(new PutItemCommand({
          TableName: TBL_SETTINGS,
          Item: {
            PK: pk, SK: sk,
            planType: { S: "free" },
            apiDailyLimit: { N: "200" },
            apiUsageDate: { S: todayKeyJst() },
            apiUsedCount: { N: "0" },
            autoPost: { BOOL: false },
            autoPostAdminStop: { BOOL: false },
            updatedAt: { N: `${Math.floor(Date.now() / 1000)}` },
          },
          ConditionExpression: "attribute_not_exists(PK)",
        }));
      }

      // 日付切替でカウントリセット
      const item = (got.Item || {}) as any;
      const savedDate = item.apiUsageDate?.S || todayKeyJst();
      if (savedDate !== todayKeyJst()) {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: pk, SK: sk },
          UpdateExpression: "SET apiUsageDate = :d, apiUsedCount = :z, updatedAt = :u",
          ExpressionAttributeValues: {
            ":d": { S: todayKeyJst() },
            ":z": { N: "0" },
            ":u": { N: `${Math.floor(Date.now() / 1000)}` },
          },
        }));
        item.apiUsageDate = { S: todayKeyJst() };
        item.apiUsedCount = { N: "0" };
      }

      results.push({
        userId: sub,
        email,
        planType: item.planType?.S || "free",
        apiDailyLimit: Number(item.apiDailyLimit?.N || "200"),
        apiUsedCount: Number(item.apiUsedCount?.N || "0"),
        autoPostAdminStop: Boolean(item.autoPostAdminStop?.BOOL || false),
        autoPost: Boolean(item.autoPost?.BOOL || false),
        updatedAt: Number(item.updatedAt?.N || 0),
      });
    }

    results.sort((a, b) => (a.email || "").localeCompare(b.email || "", "ja"));
    return res.status(200).json({ items: results });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "forbidden" ? 403 : e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
