// Debug endpoint: create test scheduled post for remigiozarcorb618
import type { NextApiRequest, NextApiResponse } from "next";
import { PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import crypto from "crypto";

const ddb = createDynamoClient();
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_THREADS = "ThreadsAccounts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const { accountId = "remigiozarcorb618", mode = "posted" } = req.body || {};
    const now = Math.floor(Date.now() / 1000);
    const scheduledPostId = crypto.randomUUID();

    // Create a posted scheduled post with waiting doublePostStatus (simulate auto-post that posted)
    const item: any = {
      PK: { S: `USER#${userId}` },
      SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
      scheduledPostId: { S: scheduledPostId },
      accountId: { S: accountId },
      accountName: { S: "remigio test" },
      autoPostGroupId: { S: "自動投稿1" },
      theme: { S: "自動投稿テスト" },
      content: { S: "自動投稿の動作確認用テスト投稿です。" },
      scheduledAt: { N: String(now - 3600) },
      postedAt: { N: String(now - 1800) },
      status: { S: mode === "posted" ? "posted" : "scheduled" },
      postId: { S: "remigio_test_post" },
      numericPostId: { S: "1234567890" },
      postUrl: { S: "https://www.threads.net/post/remigio_test_post" },
      doublePostStatus: { S: mode === "posted" ? "waiting" : "" },
      isDeleted: { BOOL: false },
      createdAt: { N: String(now) },
      timeRange: { S: "00:00-23:59" },
      isNewAutoPost: { BOOL: true },
    };

    await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));

    // Ensure account has secondStageContent for testing
    let accountUpdated = false;
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: TBL_THREADS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: "SET secondStageContent = :c, autoPostGroupId = :g",
        ExpressionAttributeValues: {
          ":c": { S: "二段階投稿テスト: 追加入力のテキストです。" },
          ":g": { S: "default" },
        },
      }));
      accountUpdated = true;
    } catch (e) {
      accountUpdated = false;
    }

    return res.status(200).json({
      ok: true,
      scheduledPostId,
      accountId,
      accountUpdated,
      usage: {
        checkDebug: `/api/debug/second-stage-detail (removed by cleanup) - use /api/debug/remigio-test to create/test`,
        runSecondStage: `POST /api/scheduled-posts/second-stage with { scheduledPostId: "${scheduledPostId}" }`,
      },
    });
  } catch (e: any) {
    console.error("remigio-test error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}


