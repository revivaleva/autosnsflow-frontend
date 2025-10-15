// /src/pages/api/admin/users.ts
// [MOD] GET専用→ GET / PATCH を受け付ける分岐に変更
// [ADD] PATCH: UserSettings を更新（apiDailyLimit / autoPostAdminStop / autoPost / updatedAt）

import type { NextApiRequest, NextApiResponse } from "next";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest, assertAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { getServerAwsCredentials } from "@/lib/aws-creds";

const ddb = createDynamoClient();
const cipa = new CognitoIdentityProviderClient({
  region: env.AWS_REGION,
  credentials: getServerAwsCredentials(),
});
const USER_POOL_ID = env.COGNITO_USER_POOL_ID;
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

function todayKeyJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // [MOD] メソッド分岐を追加
    if (req.method === "GET") {
      const user = await verifyUserFromRequest(req);
      assertAdmin(user);

      const usersResp = await cipa.send(
        new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 })
      );
      const list = usersResp.Users || [];
      const results: any[] = [];

      for (const u of list) {
        const sub   = u.Attributes?.find(a => a?.Name === "sub")?.Value || "";
        const email = u.Attributes?.find(a => a?.Name === "email")?.Value || "";
        if (!sub) continue;

        const pk = { S: `USER#${sub}` };
        const sk = { S: "SETTINGS" };

        // 初期化 or 取得
        const got = await ddb.send(new GetItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: pk, SK: sk },
        }));
        if (!got.Item) {
          await ddb.send(new PutItemCommand({
            TableName: TBL_SETTINGS,
            Item: {
              PK: pk, SK: sk,
              planType:        { S: "free" },
              apiDailyLimit:   { N: "200" },
              username:        { S: "" },
              maxThreadsAccounts: { N: "0" },
              apiUsageDate:    { S: todayKeyJst() },
              apiUsedCount:    { N: "0" },
              autoPost:        { BOOL: false },
              autoPostAdminStop:{ BOOL: false },
              updatedAt:       { N: `${Math.floor(Date.now()/1000)}` },
            },
            ConditionExpression: "attribute_not_exists(PK)",
          }));
        }

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
              ":u": { N: `${Math.floor(Date.now()/1000)}` },
            },
          }));
          item.apiUsageDate = { S: todayKeyJst() };
          item.apiUsedCount = { N: "0" };
        }

        results.push({
          userId: sub,
          email,
          username:          item.username?.S || "",
          planType:          item.planType?.S || "free",
          apiDailyLimit:     Number(item.apiDailyLimit?.N || "200"),
          apiUsedCount:      Number(item.apiUsedCount?.N || "0"),
          maxThreadsAccounts: Number(item.maxThreadsAccounts?.N || "0"),
          autoPostAdminStop: Boolean(item.autoPostAdminStop?.BOOL || false),
          autoPost:          Boolean(item.autoPost?.BOOL || false),
          updatedAt:         Number(item.updatedAt?.N || 0),
        });
      }
      results.sort((a, b) => (a.email || "").localeCompare(b.email || "", "ja"));
      return res.status(200).json({ items: results });
    }

    // [ADD] 保存処理：モーダルからの PATCH に対応
    if (req.method === "PATCH") {
      const user = await verifyUserFromRequest(req);
      assertAdmin(user);

    const { userId, apiDailyLimit, autoPostAdminStop, autoPost, username, maxThreadsAccounts } = (req.body || {}) as {
      userId?: string;
      apiDailyLimit?: number | string;
      autoPostAdminStop?: boolean;
      autoPost?: boolean;
      username?: string;
      maxThreadsAccounts?: number | string;
    };

      if (!userId) return res.status(400).json({ error: "userId is required" });

      const limitNum = Number(apiDailyLimit);
      if (!Number.isFinite(limitNum) || limitNum < 0) {
        return res.status(400).json({ error: "apiDailyLimit must be a number >= 0" });
      }

      const maxThreadsNum = typeof maxThreadsAccounts !== 'undefined' ? Number(maxThreadsAccounts) : undefined;
      if (typeof maxThreadsNum !== 'undefined' && (!Number.isFinite(maxThreadsNum) || maxThreadsNum < 0)) {
        return res.status(400).json({ error: "maxThreadsAccounts must be a number >= 0" });
      }

      const key = { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } };
      // Build update expression dynamically to include optional fields (username, maxThreadsAccounts)
      const sets: string[] = ["apiDailyLimit = :lim", "autoPostAdminStop = :stp", "autoPost = :aut", "updatedAt = :u"];
      const values: Record<string, any> = {
        ":lim": { N: String(Math.floor(limitNum)) },
        ":stp": { BOOL: !!autoPostAdminStop },
        ":aut": { BOOL: !!autoPost },
        ":u":   { N: String(Math.floor(Date.now()/1000)) },
      };

      if (typeof username === 'string') {
        sets.push("username = :un");
        values[":un"] = { S: username };
      }
      if (typeof maxThreadsNum !== 'undefined') {
        sets.push("maxThreadsAccounts = :mta");
        values[":mta"] = { N: String(Math.floor(maxThreadsNum)) };
      }

      await ddb.send(new UpdateItemCommand({
        TableName: TBL_SETTINGS,
        Key: key,
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeValues: values,
        ReturnValues: "NONE",
      }));

      return res.status(200).json({ ok: true });
    }

    // [MOD] 未対応メソッドは405
    return res.status(405).json({ error: "Method Not Allowed" });

  } catch (e: any) {
    const msg = String(e?.message || "");
    const code =
      e?.statusCode || (msg.includes("Could not load credentials") ? 500 : 500);
    const wrapped = msg.includes("Could not load credentials")
      ? "AWS認証情報を読み込めませんでした。環境変数 AUTOSNSFLOW_ACCESS_KEY_ID / AUTOSNSFLOW_SECRET_ACCESS_KEY を設定してください。"
      : e?.message || "internal_error";
    return res.status(code).json({ error: wrapped });
  }
}
