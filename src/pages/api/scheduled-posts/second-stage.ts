// /src/pages/api/scheduled-posts/second-stage.ts
// 即時二段階投稿API
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postToThreads } from "@/lib/threads";

const ddb = createDynamoClient();
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_THREADS = "ThreadsAccounts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { scheduledPostId } = req.body || {};
    
    if (!scheduledPostId) {
      return res.status(400).json({ error: "scheduledPostId is required" });
    }

    // 予約投稿情報を取得
    const scheduledPost = await ddb.send(new GetItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `SCHEDULEDPOST#${scheduledPostId}` }
      },
    }));

    if (!scheduledPost.Item) {
      return res.status(404).json({ error: "Scheduled post not found" });
    }

    const accountId = scheduledPost.Item.accountId?.S;
    const postId = scheduledPost.Item.numericPostId?.S || scheduledPost.Item.postId?.S; // 数字IDを優先
    const doublePostStatus = scheduledPost.Item.doublePostStatus?.S;
    const status = scheduledPost.Item.status?.S;

    if (!accountId) {
      return res.status(400).json({ error: "Invalid scheduled post: missing accountId" });
    }

    if (status !== "posted") {
      return res.status(400).json({ error: "Cannot perform second stage: post not yet posted" });
    }

    if (doublePostStatus === "done") {
      return res.status(400).json({ error: "Second stage already completed" });
    }

    if (!postId) {
      return res.status(400).json({ error: "Cannot perform second stage: original postId missing" });
    }

    // アカウント情報（アクセストークン・providerUserId・二段階投稿内容）を取得
    const accountItem = await ddb.send(new GetItemCommand({
      TableName: TBL_THREADS,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `ACCOUNT#${accountId}` }
      },
      ProjectionExpression: "accessToken, providerUserId, secondStageContent",
    }));

    if (!accountItem.Item) {
      return res.status(404).json({ error: "Account not found" });
    }

    const accessToken = accountItem.Item.accessToken?.S;
    const providerUserId = accountItem.Item.providerUserId?.S;
    const secondStageContent = accountItem.Item.secondStageContent?.S;

    if (!accessToken || !providerUserId) {
      return res.status(400).json({ error: "Account missing accessToken or providerUserId" });
    }

    if (!secondStageContent?.trim()) {
      return res.status(400).json({ error: "Account missing secondStageContent" });
    }

    // デバッグログ追加
    console.log(`[DEBUG] 二段階投稿開始: scheduledPostId=${scheduledPostId}, postId=${postId}, providerUserId=${providerUserId}`);
    console.log(`[DEBUG] 二段階投稿パラメータ: inReplyTo=${postId}, text=${secondStageContent.substring(0, 50)}...`);

    // Threadsに二段階投稿（元の投稿にリプライ）- 修正済みのpostToThreads使用
    const { postId: secondStagePostId } = await postToThreads({
      accessToken,
      text: secondStageContent,
      userIdOnPlatform: providerUserId,
      inReplyTo: postId, // 元の投稿IDにリプライ
    });

    console.log(`[DEBUG] 二段階投稿完了: secondStagePostId=${secondStagePostId}`);

    // DBのステータスを更新
    const now = Math.floor(Date.now() / 1000);
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `SCHEDULEDPOST#${scheduledPostId}` }
      },
      UpdateExpression: "SET doublePostStatus = :done, secondStagePostId = :pid, secondStageAt = :ts",
      ExpressionAttributeValues: {
        ":done": { S: "done" },
        ":pid": { S: secondStagePostId },
        ":ts": { N: String(now) },
      },
      ConditionExpression: "doublePostStatus <> :done", // 重複防止
    }));

    return res.status(200).json({
      ok: true,
      secondStagePostId,
      message: "二段階投稿を実行しました"
    });

  } catch (e: any) {
    console.error("second-stage error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: e?.message || "Unknown error"
    });
  }
}
