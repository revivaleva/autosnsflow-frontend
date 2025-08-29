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

    // replyId が "REPLY#..." の形式で渡される可能性があるため正規化
    const normalized = String(replyId).startsWith("REPLY#") ? String(replyId).slice(6) : String(replyId);

    const key = { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${normalized}` } };

    // 存在確認
    const existing = await ddb.send(new GetItemCommand({ TableName: TBL_REPLIES, Key: key }));
    if (!existing.Item) return res.status(404).json({ error: "Reply not found" });

    // 物理削除
    await ddb.send(new (require('@aws-sdk/client-dynamodb').DeleteItemCommand)({
      TableName: TBL_REPLIES,
      Key: key,
    }));

    return res.status(200).json({ ok: true });

  } catch (e: any) {
    console.error("replies/delete error:", e);
    return res.status(500).json({ error: "Internal Server Error", message: e?.message || "Unknown" });
  }
}


