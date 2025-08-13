// /src/pages/api/user-settings.ts
// [MOD] 暫定の固定userIdを廃止し、Cognito IdToken から特定
import type { NextApiRequest, NextApiResponse } from "next";
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { verifyUserFromRequest } from "@/lib/auth"; // [ADD]

const region = process.env.AWS_REGION || "ap-northeast-1";
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

const ddb = new DynamoDBClient({ region });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req); // [ADD] 本番仕様: JWT検証
    const userId = user.sub;                        // [ADD]

    if (req.method === "GET") {
      const out = await ddb.send(
        new GetItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
        })
      );
      const it: any = out.Item || {};
      const body = {
        discordWebhooks: (it.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean),
        planType: it.planType?.S || "free",
        // [KEEP] 参照用に返す（編集は不可）
        dailyOpenAiLimit: it.dailyOpenAiLimit?.N ? Number(it.dailyOpenAiLimit.N) : 200,
        defaultOpenAiCost: it.defaultOpenAiCost?.N ? Number(it.defaultOpenAiCost.N) : 1,
      };
      return res.status(200).json(body);
    }

    if (req.method === "PUT") {
      const { discordWebhooks, planType } = req.body || {};
      const wl = Array.isArray(discordWebhooks) ? discordWebhooks : [];
      // [KEEP][MOD] 上限値は管理APIのみで変更可能のためUpdate対象から除外
      await ddb.send(
        new UpdateItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
          UpdateExpression: "SET discordWebhooks = :w, planType = :p, updatedAt = :ts",
          ExpressionAttributeValues: {
            ":w": { L: wl.map((s: string) => ({ S: s })) },
            ":p": { S: (planType || "free").toString() },
            ":ts": { N: String(Math.floor(Date.now() / 1000)) },
          },
        })
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
