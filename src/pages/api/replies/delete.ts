import type { NextApiRequest, NextApiResponse } from "next";
import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_REPLIES = process.env.TBL_REPLIES || "Replies";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "PATCH") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { replyId } = req.body || {};
    if (!replyId) return res.status(400).json({ error: "replyId is required" });

    // 存在確認
    const key = { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${replyId}` } };
    const existing = await ddb.send(new GetItemCommand({ TableName: TBL_REPLIES, Key: key }));
    if (!existing.Item) return res.status(404).json({ error: "Reply not found" });

    // 論理削除フラグをセット（isDeleted=true, deletedAt）
    const now = Math.floor(Date.now() / 1000);
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_REPLIES,
      Key: key,
      UpdateExpression: "SET isDeleted = :t, deletedAt = :ts, #st = :deleted",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":t": { BOOL: true },
        ":ts": { N: String(now) },
        ":deleted": { S: "deleted" }
      }
    }));

    return res.status(200).json({ ok: true });

  } catch (e: any) {
    console.error("replies/delete error:", e);
    return res.status(500).json({ error: "Internal Server Error", message: e?.message || "Unknown" });
  }
}


