// /src/pages/api/admin/users.ts
// 管理者用: 全Cognitoユーザー一覧 + UserSettings自動初期化 + 当日使用数/上限/停止フラグを返却
import type { NextApiRequest, NextApiResponse } from "next";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

const ddb = new DynamoDBClient({ region: REGION });
const cipa = new CognitoIdentityProviderClient({ region: REGION });

async function verifyAdminFromIdToken(idToken: string) {
  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
  const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(idToken, JWKS, { issuer });
  const groups = (payload["cognito:groups"] as string[]) || [];
  if (!groups.includes("admin")) throw new Error("forbidden");
  return payload;
}

function todayKeyJst(): string {
  // JST基準の日付キー YYYY-MM-DD
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

async function getOrInitUserSettings(userId: string) {
  const pk = { S: `USER#${userId}` };
  const sk = { S: "SETTINGS" };

  const out = await ddb.send(
    new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: pk, SK: sk } })
  );
  if (out.Item) return out.Item;

  // 初期化：apiDailyLimit=200, apiUsageDate=today, apiUsedCount=0, autoPost=false(既存項目), autoPostAdminStop=false
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

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    await verifyAdminFromIdToken(token); // ここで403相当の判定

    // Cognito全ユーザー一覧（最大1000件想定。多い場合はpagination追加）
    const usersResp = await cipa.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60, // 必要ならページングで増やしてください
    }));

    const list = usersResp.Users || [];
    const results: any[] = [];

    for (const u of list) {
      const sub = u.Attributes?.find(a => a?.Name === "sub")?.Value || "";
      const email = u.Attributes?.find(a => a?.Name === "email")?.Value || "";
      if (!sub) continue;

      const settings = await getOrInitUserSettings(sub);
      // 当日のapiUsageDateが変わっていたら0リセット（一覧時に揃えておく）
      const today = todayKeyJst();
      const savedDate = settings.apiUsageDate?.S || today;
      if (savedDate !== today) {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: { S: `USER#${sub}` }, SK: { S: "SETTINGS" } },
          UpdateExpression: "SET apiUsageDate = :d, apiUsedCount = :z, updatedAt = :u",
          ExpressionAttributeValues: {
            ":d": { S: today },
            ":z": { N: "0" },
            ":u": { N: `${Math.floor(Date.now() / 1000)}` },
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
        autoPost: Boolean(settings.autoPost?.BOOL || false), // 既存項目(UserSettings.autoPost)を管理画面からも編集
        updatedAt: Number(settings.updatedAt?.N || 0),
      });
    }

    // email昇順
    results.sort((a, b) => (a.email || "").localeCompare(b.email || "", "ja"));

    return res.status(200).json({ items: results });
  } catch (e: any) {
    const code = e?.message === "forbidden" ? 403 : 500;
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
