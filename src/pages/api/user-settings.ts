// /src/pages/api/user-settings.ts
// [MOD] 設定APIを「ログインユーザーの sub でDynamoDB を読む」本番仕様に統一
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb"; // [ADD]
import { verifyUserFromRequest } from "@/lib/auth"; // [ADD]

const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";
const ddb = createDynamoClient(); // [ADD]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req); // [ADD]
    const userId = user.sub;                        // [ADD]

    if (req.method === "GET") {
      const out = await ddb.send(
        new GetItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
        })
      );
      const it: any = out.Item || {};
      return res.status(200).json({
        discordWebhooks: (it.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean),
        planType: it.planType?.S || "free",
        dailyOpenAiLimit: it.dailyOpenAiLimit?.N ? Number(it.dailyOpenAiLimit.N) : 200,
        defaultOpenAiCost: it.defaultOpenAiCost?.N ? Number(it.defaultOpenAiCost.N) : 1,
      });
    }

    if (req.method === "PUT") {
      const { discordWebhooks, planType } = req.body || {};
      const wl = Array.isArray(discordWebhooks) ? discordWebhooks : [];
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
    console.error("user-settings error:", e?.detail || e);
    const msg = String(e?.message || "");
    const code =
      e?.statusCode ||
      (msg === "Unauthorized" ? 401 : msg.includes("credentials") ? 500 : 500);
    return res.status(code).json({
      error:
        msg === "jwks_fetch_failed"
          ? "認証設定エラー（JWKS取得失敗）"
          : msg || "internal_error",
    });
  }
}
