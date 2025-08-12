// /src/pages/api/admin/users/[userId].ts
// 管理者用: 指定ユーザーの UserSettings を更新（apiDailyLimit / autoPostAdminStop / autoPost）
import type { NextApiRequest, NextApiResponse } from "next";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";
const ddb = new DynamoDBClient({ region: REGION });

async function verifyAdminFromIdToken(idToken: string) {
  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
  const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(idToken, JWKS, { issuer });
  const groups = (payload["cognito:groups"] as string[]) || [];
  if (!groups.includes("admin")) throw new Error("forbidden");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "PATCH") return res.status(405).json({ error: "Method Not Allowed" });

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    await verifyAdminFromIdToken(token);

    const { userId } = req.query as { userId: string };
    const { apiDailyLimit, autoPostAdminStop, autoPost } = req.body || {};

    const sets: string[] = [];
    const names: Record<string, any> = {};
    const values: Record<string, any> = {
      ":u": { N: `${Math.floor(Date.now() / 1000)}` },
    };

    if (typeof apiDailyLimit === "number") {
      sets.push("apiDailyLimit = :adl");
      values[":adl"] = { N: String(apiDailyLimit) };
    }
    if (typeof autoPostAdminStop === "boolean") {
      sets.push("autoPostAdminStop = :aps");
      values[":aps"] = { BOOL: autoPostAdminStop };
    }
    if (typeof autoPost === "boolean") {
      // 既存のUserSettings.autoPostを管理側から更新
      sets.push("autoPost = :ap");
      values[":ap"] = { BOOL: autoPost };
    }

    if (sets.length === 0) return res.status(400).json({ error: "no_fields" });
    sets.push("updatedAt = :u");

    await ddb.send(
      new UpdateItemCommand({
        TableName: TBL_SETTINGS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames: names,
      })
    );

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    const code = e?.message === "forbidden" ? 403 : 500;
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
