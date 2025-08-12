// /src/pages/api/user-settings.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

// ここから追加
const resolvedCredentials =
  (process.env.AUTOSNSFLOW_ACCESS_KEY_ID && process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY)
    ? {
        accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY as string,
      }
    : (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      }
    : undefined;
// ここまで追加

const ddb = new DynamoDBClient({ region, credentials: resolvedCredentials });

function getUserId(req: NextApiRequest): string {
  return (req.headers["x-user-id"] as string)
    || process.env.USER_ID
    || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserId(req);

  try {
    if (req.method === "GET") {
      // [FIX] GETでreq.bodyは読まない。未登録ならデフォルト返却して200
      const out = await ddb.send(new GetItemCommand({
        TableName: TBL_SETTINGS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      }));

      const item = out.Item;
      const payload = item ? {
        discordWebhooks: (item.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean),
        openAiApiKey: item.openAiApiKey?.S || "",
        modelDefault: item.modelDefault?.S || "",
        planType: item.planType?.S || "free",
        remainingCredits: Number(item.remainingCredits?.N || "0"),
        updatedAt: Number(item.updatedAt?.N || "0"),
      } : {
        // [ADD] 未設定時の安全なデフォルト
        discordWebhooks: [],
        openAiApiKey: "",
        modelDefault: "",
        planType: "free",
        remainingCredits: 0,
        updatedAt: 0,
      };

      res.status(200).json(payload);
      return;
    }

    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const discordWebhooks: string[] = Array.isArray(body?.discordWebhooks) ? body.discordWebhooks : [];
      const now = Math.floor(Date.now() / 1000);

      await ddb.send(new PutItemCommand({
        TableName: TBL_SETTINGS,
        Item: {
          PK: { S: `USER#${userId}` },
          SK: { S: "SETTINGS" },
          discordWebhooks: { L: discordWebhooks.map((u) => ({ S: u })) },
          openAiApiKey: { S: body?.openAiApiKey || "" },
          modelDefault: { S: body?.modelDefault || "" },
          planType: { S: body?.planType || "free" },
          remainingCredits: { N: String(body?.remainingCredits ?? 0) },
          updatedAt: { N: String(now) },
        },
      }));

      res.status(200).json({ success: true });
      return;
    }

    res.setHeader("Allow", "GET,PUT");
    res.status(405).end("Method Not Allowed");
  } catch (e: any) {
    console.error("user-settings error", e); // [ADD]
    res.status(500).json({ error: e?.message || "internal error" });
  }
}
