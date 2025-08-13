// /src/pages/api/admin/users.ts
// [MOD] AuthorizationヘッダだけでなくCookieのidTokenでも認証/検証する
import type { NextApiRequest, NextApiResponse } from "next";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { verifyUserFromRequest, assertAdmin } from "@/lib/auth"; // [ADD]

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

const ddb = new DynamoDBClient({ region: REGION });
const cipa = new CognitoIdentityProviderClient({ region: REGION });

function todayKeyJst(): string {
  // JST基準の日付キー YYYY-MM-DD
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

async function getOrInitUserSettings(userId: string) {
  const pk = { S: `USER#${userId}` };
  const sk = { S: "SETTINGS" };
  const out = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: pk, SK: sk } }));
  if (out.Item) return out.Item;
  // [KEEP] 初期化ロジックは既存どおり
  const item = {
    PK: pk,
    SK: sk,
    planType: { S: "free" },
    apiDailyLimit: { N: "200" },
    apiUsageDate: { S: todayKeyJst() },
    apiUsedCount: { N: "0" },
    autoPost: { BOOL: false },
    autoPostAdminStop: { BOOL: false },
    updatedAt: { N: `${Math.floor(Date.now() / 1000)}` },
  };
  await ddb.send(new PutItemCommand({ TableName: TBL_SETTINGS, Item: item, ConditionExpression: "attribute_not_exists(PK)" }));
  return item;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req); // [ADD] Cookie/Authorization対応
    assertAdmin(user);                              // [ADD] adminグループ必須

    // [KEEP] Cognito全ユーザー一覧→UserSettings同期
    const usersResp = await cipa.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }));
    const list = usersResp.Users || [];
    const results: any[] = [];

    for (const u of list) {
      const sub = u.Attributes?.find(a => a?.Name === "sub")?.Value || "";
      const email = u.Attributes?.find(a => a?.Name === "email")?.Value || "";
      if (!sub) continue;
      const settings: any = await getOrInitUserSettings(sub);

      // [KEEP] 日付ズレの0リセット
      const today = todayKeyJst();
      const savedDate = settings.apiUsageDate?.S || today;
      if (savedDate !== today) {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: { S: `USER#${sub}` }, SK: { S: "SETTINGS" } },
          UpdateExpression: "SET apiUsageDate = :d, apiUsedCount = :z, updatedAt = :u",
          ExpressionAttributeValues: {
            ":d": { S: today }, ":z": { N: "0" }, ":u": { N: `${Math.floor(Date.now() / 1000)}` },
          },
        }));
        settings.apiUsageDate = { S: today };
        settings.apiUsedCount = { N: "0" };
      }

      results.push({
        userId: sub,
        email,
        planType: settings.planType?.S || "free",
        apiDailyLimit: Number(settings.apiDailyLimit?.N || "200"),
        apiUsedCount: Number(settings.apiUsedCount?.N || "0"),
        autoPostAdminStop: Boolean(settings.autoPostAdminStop?.BOOL || false),
        autoPost: Boolean(settings.autoPost?.BOOL || false),
        updatedAt: Number(settings.updatedAt?.N || 0),
      });
    }

    results.sort((a, b) => (a.email || "").localeCompare(b.email || "", "ja"));
    return res.status(200).json({ items: results });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "forbidden" ? 403 : e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
