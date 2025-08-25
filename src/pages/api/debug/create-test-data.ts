// /src/pages/api/debug/create-test-data.ts
// デバッグ用テストデータ作成API
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

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { 
      accountId = "remigiozarcorb618",
      dataType = "complete" // "complete", "minimal", "broken"
    } = req.body || {};

    const now = Math.floor(Date.now() / 1000);
    const scheduledPostId = crypto.randomUUID();

    let testData: any = {};

    if (dataType === "complete") {
      // 完全なテストデータ（二段階投稿可能状態）
      testData = {
        scheduledPost: {
          PK: { S: `USER#${userId}` },
          SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
          scheduledPostId: { S: scheduledPostId },
          accountId: { S: accountId },
          accountName: { S: "テストアカウント" },
          autoPostGroupId: { S: "自動投稿1" },
          theme: { S: "テスト投稿" },
          content: { S: "これはテスト用の投稿です。二段階投稿のテストに使用されます。" },
          scheduledAt: { N: String(now - 3600) }, // 1時間前
          postedAt: { N: String(now - 1800) }, // 30分前
          status: { S: "posted" },
          postId: { S: "test_post_id_12345" },
          numericPostId: { S: "67890" },
          postUrl: { S: "https://www.threads.net/post/test_post_id_12345" },
          doublePostStatus: { S: "waiting" },
          isDeleted: { BOOL: false },
          createdAt: { N: String(now - 3600) },
        },
        message: "完全なテストデータを作成しました（二段階投稿実行可能）"
      };
    } else if (dataType === "minimal") {
      // 最小限のテストデータ
      testData = {
        scheduledPost: {
          PK: { S: `USER#${userId}` },
          SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
          scheduledPostId: { S: scheduledPostId },
          accountId: { S: accountId },
          accountName: { S: "テストアカウント" },
          content: { S: "最小限のテスト投稿" },
          scheduledAt: { N: String(now) },
          status: { S: "scheduled" },
          isDeleted: { BOOL: false },
          createdAt: { N: String(now) },
        },
        message: "最小限のテストデータを作成しました（未投稿状態）"
      };
    } else if (dataType === "broken") {
      // 問題のあるテストデータ（デバッグ用）
      testData = {
        scheduledPost: {
          PK: { S: `USER#${userId}` },
          SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
          scheduledPostId: { S: scheduledPostId },
          accountId: { S: accountId },
          accountName: { S: "問題のあるテストアカウント" },
          content: { S: "問題のあるテスト投稿" },
          scheduledAt: { N: String(now) },
          postedAt: { N: String(now) },
          status: { S: "posted" },
          // postId と numericPostId が意図的に欠落
          doublePostStatus: { S: "waiting" },
          isDeleted: { BOOL: false },
          createdAt: { N: String(now) },
        },
        message: "問題のあるテストデータを作成しました（postID欠落）"
      };
    }

    // データベースに保存
    await ddb.send(new PutItemCommand({
      TableName: TBL_SCHEDULED,
      Item: testData.scheduledPost,
    }));

    // アカウントの二段階投稿設定も確認・更新
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: TBL_THREADS,
        Key: { 
          PK: { S: `USER#${userId}` }, 
          SK: { S: `ACCOUNT#${accountId}` }
        },
        UpdateExpression: "SET secondStageContent = :content",
        ExpressionAttributeValues: {
          ":content": { S: "これは二段階投稿のテスト内容です。🚀" }
        },
        ConditionExpression: "attribute_exists(PK)", // アカウントが存在する場合のみ
      }));
      testData.accountUpdated = true;
    } catch (e) {
      testData.accountUpdated = false;
      testData.accountError = String(e);
    }

    return res.status(200).json({
      ok: true,
      scheduledPostId,
      dataType,
      testData,
      usage: {
        detailDebug: `POST /api/debug/second-stage-detail with {"scheduledPostId": "${scheduledPostId}"}`,
        secondStageTest: `POST /api/scheduled-posts/second-stage with {"scheduledPostId": "${scheduledPostId}"}`,
      }
    });

  } catch (e: any) {
    console.error("create-test-data error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: e?.message || "Unknown error"
    });
  }
}
