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

// GAS/Lambda準拠のThreads投稿関数（リプライ対応）
async function postToThreadsWithReply({ accessToken, text, userIdOnPlatform, inReplyTo }: {
  accessToken: string;
  text: string;
  userIdOnPlatform: string;
  inReplyTo?: string;
}): Promise<{ postId: string }> {
  if (!accessToken) throw new Error("Threads accessToken 未設定");
  if (!userIdOnPlatform) throw new Error("Threads userId 未設定");

  const base = `https://graph.threads.net/v1.0/${encodeURIComponent(userIdOnPlatform)}`;

  // コンテナ作成（GAS/Lambda同様）
  const createPayload: any = {
    media_type: "TEXT",
    text,
    access_token: accessToken,
  };
  
  if (inReplyTo) {
    createPayload.replied_to_id = inReplyTo;
  }

  let createRes = await fetch(`${base}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createPayload),
  });

  // エラー時のリトライ（Lambda準拠）
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    console.log(`[WARN] Threads create失敗、リトライ: ${createRes.status} ${errText}`);
    
    // パラメータ調整してリトライ
    const retryPayload = { ...createPayload };
    if (inReplyTo) {
      // replied_to_idの代替フィールド名を試行
      delete retryPayload.replied_to_id;
      retryPayload.reply_to_id = inReplyTo;
    }
    
    const retried = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(retryPayload),
    });
    
    if (!retried.ok) {
      const err2 = await retried.text().catch(() => "");
      throw new Error(
        `Threads create error: first=${createRes.status} ${errText} / retry=${retried.status} ${err2}`
      );
    }
    createRes = retried;
  }

  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    throw new Error(`Threads create error: ${createRes.status} ${t}`);
  }

  const createJson = await createRes.json().catch(() => ({}));
  const creation_id = createJson?.id;
  if (!creation_id) throw new Error("Threads creation_id 取得失敗");

  // 公開（GAS/Lambda同様）
  const pubRes = await fetch(`${base}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id, access_token: accessToken }),
  });
  
  if (!pubRes.ok) {
    const t = await pubRes.text().catch(() => "");
    throw new Error(`Threads publish error: ${pubRes.status} ${t}`);
  }
  
  const pubJson = await pubRes.json().catch(() => ({}));
  const postId = pubJson?.id || creation_id;
  
  return { postId };
}

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
    const postId = scheduledPost.Item.postId?.S; // 初回投稿のpostId（リプライ先）
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

    // Threadsに二段階投稿（元の投稿にリプライ）
    const { postId: secondStagePostId } = await postToThreadsWithReply({
      accessToken,
      text: secondStageContent,
      userIdOnPlatform: providerUserId,
      inReplyTo: postId, // 元の投稿IDにリプライ
    });

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
