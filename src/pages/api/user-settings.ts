// /src/pages/api/user-settings.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import jwt from "jsonwebtoken";

const REGION = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

const ddb = new DynamoDBClient({
  region: REGION,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        }
      : undefined, // ← 環境変数が無ければ実行ロールを使用
});

function getUserId(req: NextApiRequest) {
  const token =
    (req.cookies?.idToken as string) ||
    (req.headers.authorization?.replace(/^Bearer\s+/i, "") as string) ||
    "";
  const payload = token ? (jwt.decode(token) as any) : null;
  return payload?.sub || process.env.DEBUG_USER_ID || "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    if (req.method === "GET") {
      const out = await ddb.send(
        new GetItemCommand({
          TableName: TBL_SETTINGS,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
        })
      );

      const item = out.Item
        ? {
            discordWebhooks: (out.Item.discordWebhooks?.L || []).map((x: any) => x.S),
            openAiApiKey: out.Item.openAiApiKey?.S || "",
            planType: out.Item.planType?.S || "free",
            remainingCredits: Number(out.Item.remainingCredits?.N || "0"),
            modelDefault: out.Item.modelDefault?.S || "gpt-3.5-turbo",
            masterPrompt: out.Item.masterPrompt?.S || "",
            replyPrompt: out.Item.replyPrompt?.S || "",
            autoPost: out.Item.autoPost?.BOOL ?? true,
            dispatchDelayMinutes: Number(out.Item.dispatchDelayMinutes?.N || "0"),
          }
        : null;

      return res.status(200).json(
        item || {
          discordWebhooks: [],
          openAiApiKey: "",
          planType: "free",
          remainingCredits: 0,
          modelDefault: "gpt-3.5-turbo",
          masterPrompt: "",
          replyPrompt: "",
          autoPost: true,
          dispatchDelayMinutes: 0,
        }
      );
    }

    if (req.method === "PUT") {
      const b = req.body || {};
      await ddb.send(
        new PutItemCommand({
          TableName: TBL_SETTINGS,
          Item: {
            PK: { S: `USER#${getUserId(req)}` },
            SK: { S: "SETTINGS" },
            discordWebhooks: { L: (b.discordWebhooks || []).map((s: string) => ({ S: s })) },
            openAiApiKey: { S: b.openAiApiKey || "" },
            planType: { S: b.planType || "free" },
            remainingCredits: { N: String(b.remainingCredits ?? 0) },
            modelDefault: { S: b.modelDefault || "gpt-3.5-turbo" },
            masterPrompt: { S: b.masterPrompt || "" },
            replyPrompt: { S: b.replyPrompt || "" },
            autoPost: { BOOL: Boolean(b.autoPost) },
            dispatchDelayMinutes: { N: String(b.dispatchDelayMinutes ?? 0) },
            updatedAt: { N: String(Math.floor(Date.now() / 1000)) },
          },
        })
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).end("Method Not Allowed");
  } catch (e: any) {
    return res.status(500).json({ error: e?.name || "Error", message: e?.message || String(e) });
  }
}
