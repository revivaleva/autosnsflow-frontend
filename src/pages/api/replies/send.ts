// /src/pages/api/replies/send.ts
// リプライ送信API
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postReplyViaThreads } from "@/lib/replies/common";

const ddb = createDynamoClient();
const TBL_REPLIES = "Replies";
const TBL_THREADS = "ThreadsAccounts";

// Use shared Threads posting implementation for replies.
// The actual create/publish flow is implemented in `src/lib/threads.ts` and
// invoked via `postReplyViaThreads` from `src/lib/replies/common.ts`.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { replyId, replyContent } = req.body || {};
    
    if (!replyId || !replyContent?.trim()) {
      return res.status(400).json({ error: "replyId and replyContent are required" });
    }

    // リプライ情報を取得
    // replyId may be passed as full SK ("REPLY#...") or as raw id. Accept both.
    const skVal = typeof replyId === 'string' && replyId.startsWith('REPLY#') ? replyId : `REPLY#${replyId}`;
    const replyItem = await ddb.send(new GetItemCommand({
      TableName: TBL_REPLIES,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: skVal }
      },
    }));

    if (!replyItem.Item) {
      return res.status(404).json({ error: "Reply not found" });
    }

    const accountId = replyItem.Item.accountId?.S;
    const postId = replyItem.Item.postId?.S; // リプライ先のpostId
    const currentStatus = replyItem.Item.status?.S;

    if (!accountId) {
      return res.status(400).json({ error: "Invalid reply data: missing accountId" });
    }

    if (currentStatus === "replied") {
      return res.status(400).json({ error: "Reply already sent" });
    }

    // アカウント情報（アクセストークン・providerUserId）を取得
    const accountItem = await ddb.send(new GetItemCommand({
      TableName: TBL_THREADS,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `ACCOUNT#${accountId}` }
      },
      ProjectionExpression: "accessToken, oauthAccessToken, providerUserId",
    }));

    if (!accountItem.Item) {
      return res.status(404).json({ error: "Account not found" });
    }

    const accessToken = accountItem.Item.accessToken?.S;
    const oauthAccessToken = accountItem.Item.oauthAccessToken?.S;
    const providerUserId = accountItem.Item.providerUserId?.S;

    // allow either legacy accessToken or oauthAccessToken to be present (posting uses oauthAccessToken primarily)
    if (!(accessToken || oauthAccessToken) || !providerUserId) {
      return res.status(400).json({ error: "Account missing token (accessToken/oauthAccessToken) or providerUserId" });
    }

    // debug output removed

    // Threadsにリプライを投稿（共通関数を使用）
    const { postId: responsePostId } = await postReplyViaThreads({
      accessToken: accessToken || undefined,
      oauthAccessToken: oauthAccessToken || undefined,
      providerUserId,
      inReplyTo: postId, // 元の投稿IDにリプライ
      text: replyContent,
    });

    // debug output removed

    // DBのステータスを更新
    const now = Math.floor(Date.now() / 1000);
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_REPLIES,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: skVal }
      },
      UpdateExpression: "SET #st = :replied, replyAt = :ts, responseContent = :resp, responsePostId = :pid",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":replied": { S: "replied" },
        ":ts": { N: String(now) },
        ":resp": { S: replyContent },
        ":pid": { S: responsePostId },
      },
      ConditionExpression: "#st <> :replied", // 重複防止
    }));

    return res.status(200).json({
      ok: true,
      responsePostId,
      message: "リプライを送信しました"
    });

  } catch (e: unknown) {
    console.error("replies/send error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: String(e) || "Unknown error"
    });
  }
}
