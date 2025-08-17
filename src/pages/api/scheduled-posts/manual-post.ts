// /src/pages/api/scheduled-posts/manual-post.ts
// [MOD] postId 取得後に getThreadsPermalink を呼んで postUrl を保存

import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postToThreads, getThreadsPermalink } from "@/lib/threads"; // [ADD]

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
    if (!scheduledPostId) return res.status(400).json({ error: "missing_scheduledPostId" });

    // 予約レコード
    const got = await ddb.send(new GetItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
    }));
    const it = got.Item;
    if (!it || it.isDeleted?.BOOL) return res.status(404).json({ error: "scheduled_not_found" });
    if ((it.status?.S || "scheduled") === "posted") return res.status(409).json({ error: "already_posted" });

    const content = it.content?.S || "";
    const accountId = it.accountId?.S || ""; // ← ハンドル
    if (!content || !accountId) return res.status(400).json({ error: "invalid_item" });

    // Threads 資格情報
    const acct = await ddb.send(new GetItemCommand({
      TableName: TBL_THREADS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
      ProjectionExpression: "accessToken",
    }));
    const accessToken = acct.Item?.accessToken?.S || "";
    if (!accessToken) return res.status(400).json({ error: "missing_threads_credentials" });

    // 実投稿
    const { postId } = await postToThreads({ accessToken, text: content });

    // [ADD] 正しいURL（shortcode入り）を取得
    const { url: postUrl } = await getThreadsPermalink({
      accessToken,
      postId,
      handle: accountId,
    });

    // 保存
    const now = Math.floor(Date.now() / 1000);
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
      UpdateExpression: "SET #st=:posted, postedAt=:ts, postId=:pid, threadsPostId=:pid, postUrl=:purl",
      ConditionExpression: "(attribute_not_exists(#st) OR #st <> :posted) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":posted": { S: "posted" },
        ":ts": { N: String(now) },
        ":pid": { S: postId },
        ":purl": { S: postUrl },
        ":f": { BOOL: false },
      },
    }));

    res.status(200).json({ ok: true, post: { scheduledPostId, postId, postUrl, postedAt: now, status: "posted" } });
  } catch (e: any) {
    res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}
