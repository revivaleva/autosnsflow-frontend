// src/pages/api/scheduled-posts/manual-post.ts
// [MOD] 即時投稿API：Threads実投稿 → postId を得て
//       https://www.threads.com/@{accountId}/post/{postId} を postUrl として保存
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postToThreads } from "@/lib/threads";

const ddb = createDynamoClient();
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_THREADS = "ThreadsAccounts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    const { scheduledPostId } = req.body || {};
    if (!scheduledPostId) {
      res.status(400).json({ error: "missing_scheduledPostId" });
      return;
    }

    // 予約行取得（本文/アカウントIDが必要）
    const get = await ddb.send(
      new GetItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
      })
    );
    const it = get.Item;
    if (!it || it.isDeleted?.BOOL === true) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const status = it.status?.S || "pending";
    if (status === "posted") {
      res.status(409).json({ error: "already_posted" });
      return;
    }
    const content = it.content?.S || "";
    const accountId = it.accountId?.S || ""; // ← 画面のアカウントID＝ThreadsのユーザーID（ハンドル）
    if (!content || !accountId) {
      res.status(400).json({ error: "invalid_item" });
      return;
    }

    // アカウント資格情報（アクセストークンは属性 accessToken に保存されている前提）
    const acct = await ddb.send(
      new GetItemCommand({
        TableName: TBL_THREADS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        ProjectionExpression: "accessToken",
      })
    );
    const accessToken = acct.Item?.accessToken?.S || "";
    if (!accessToken) {
      res.status(400).json({ error: "missing_threads_credentials" });
      return;
    }

    // === Threads 実投稿 ===
    // [POINT] userId にはハンドル(accountId)を渡します（lib側で /{user}/threads または /me/threads を適切に呼び分け）
    const { postId } = await postToThreads({
      userId: accountId,
      accessToken,
      text: content,
    });

    // 指定フォーマットでURL生成
    const postUrl = `https://www.threads.com/@${encodeURIComponent(accountId)}/post/${encodeURIComponent(
      postId
    )}`;

    const now = Math.floor(Date.now() / 1000);

    // DynamoDB を posted に更新（postId / postUrl も保存、互換で threadsPostId にも格納）
    await ddb.send(
      new UpdateItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
        UpdateExpression:
          "SET #st = :posted, postedAt = :ts, postId = :pid, threadsPostId = :pid, postUrl = :purl",
        ConditionExpression:
          "(attribute_not_exists(#st) OR #st <> :posted) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":posted": { S: "posted" },
          ":ts": { N: String(now) },
          ":pid": { S: postId },
          ":purl": { S: postUrl },
          ":f": { BOOL: false },
        },
      })
    );

    res.status(200).json({
      ok: true,
      post: { scheduledPostId, postId, postUrl, postedAt: now, status: "posted" },
    });
  } catch (e: any) {
    res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}
