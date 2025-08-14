// /src/pages/api/admin/users.ts
// [MOD] CIP クライアントに認証情報を渡す＆エラーメッセージをわかりやすく
import type { NextApiRequest, NextApiResponse } from "next";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest, assertAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { getServerAwsCredentials } from "@/lib/aws-creds"; // [ADD]

const ddb = createDynamoClient();
// [MOD] 認証情報を明示。未設定なら SDK のプロバイダチェーンに委ねる
const cipa = new CognitoIdentityProviderClient({
  region: env.AWS_REGION,
  credentials: getServerAwsCredentials(), // [ADD]
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
    if (req.method !== "GET")
      return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req);
    assertAdmin(user);

    // ここで credentials がないと SDK が "Could not load credentials..." を投げる
    const usersResp = await cipa.send(
      new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 })
    );
    const list = usersResp.Users || [];
    const results: any[] = [];

    for (const u of list) {
      const sub = u.Attributes?.find((a) => a?.Name === "sub")?.Value || "";
      const email = u.Attributes?.find((a) => a?.Name === "email")?.Value || "";
      if (!sub) continue;

      const pk = { S: `USER#${sub}` };
      const sk = { S: "SETTINGS" };

      // 初期化 or 取得
      const got = await ddb.send(
        new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: pk, SK: sk } })
      );
      if (!got.Item) {
        await ddb.send(
          new PutItemCommand({
            TableName: TBL_SETTINGS,
            Item: {
              PK: pk,
              SK: sk,
              planType: { S: "free" },
              apiDailyLimit: { N: "200" },
              apiUsageDate: { S: todayKeyJst() },
              apiUsedCount: { N: "0" },
              autoPost: { BOOL: false },
              autoPostAdminStop: { BOOL: false },
              updatedAt: { N: `${Math.floor(Date.now() / 1000)}` },
            },
            ConditionExpression: "attribute_not_exists(PK)",
          })
        );
      }

      // 日付切替でカウントリセット
      const item = (got.Item || {}) as any;
      const savedDate = item.apiUsageDate?.S || todayKeyJst();
      if (savedDate !== todayKeyJst()) {
        await ddb.send(
          new UpdateItemCommand({
            TableName: TBL_SETTINGS,
            Key: { PK: pk, SK: sk },
            UpdateExpression:
              "SET apiUsageDate = :d, apiUsedCount = :z, updatedAt = :u",
            ExpressionAttributeValues: {
              ":d": { S: todayKeyJst() },
              ":z": { N: "0" },
              ":u": { N: `${Math.floor(Date.now() / 1000)}` },
            },
          })
        );
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
    // [MOD] 資格情報エラーはメッセージをわかりやすく返す
    const msg = String(e?.message || "");
    const code =
      e?.statusCode ||
      (msg.includes("Could not load credentials") ? 500 : 500);
    const wrapped =
      msg.includes("Could not load credentials")
        ? "AWS認証情報を読み込めませんでした。環境変数 AUTOSNSFLOW_ACCESS_KEY_ID / AUTOSNSFLOW_SECRET_ACCESS_KEY を設定してください。"
        : e?.message || "internal_error";
    return res.status(code).json({ error: wrapped });
  }
}
