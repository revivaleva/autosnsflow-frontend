// /src/pages/api/replies/update.ts
// リプライの編集内容を保存するAPI

import type { NextApiRequest, NextApiResponse } from "next";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_REPLIES = process.env.TBL_REPLIES || "Replies";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "PUT") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { replyId, responseContent } = req.body || {};

    if (!replyId || typeof responseContent !== 'string') {
      return res.status(400).json({ error: "replyId and responseContent are required" });
    }

    // リプライの編集内容を更新
    const now = Math.floor(Date.now() / 1000);

    // Accept replyId provided either as the raw id ("abc123") or the full SK ("REPLY#abc123").
    const rawReplyId = String(replyId || "");
    const skValue = rawReplyId.startsWith("REPLY#") ? rawReplyId : `REPLY#${rawReplyId}`;

    await ddb.send(new UpdateItemCommand({
      TableName: TBL_REPLIES,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: skValue }
      },
      UpdateExpression: "SET replyContent = :content, updatedAt = :ts, #st = :status",
      ExpressionAttributeNames: {
        "#st": "status"
      },
      ExpressionAttributeValues: {
        ":content": { S: responseContent },
        ":ts": { N: String(now) },
        ":status": { S: responseContent.trim() ? "unreplied" : "draft" }
      },
      // リプライが存在することを確認
      ConditionExpression: "attribute_exists(SK)"
    }));

    return res.status(200).json({
      ok: true,
      message: "リプライ内容を更新しました"
    });

  } catch (error: any) {
    console.error("Reply update error:", error);
    
    // ConditionalCheckFailedException = リプライが存在しない
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({ 
        error: "Reply not found",
        message: "指定されたリプライが見つかりません"
      });
    }
    
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: error?.message || "Unknown error"
    });
  }
}
