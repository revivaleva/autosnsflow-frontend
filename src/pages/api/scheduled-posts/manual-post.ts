// src/pages/api/scheduled-posts/manual-post.ts
// [MOD] 予約行の取得 → Threads実投稿（/me: 作成→公開） → 成功時のみ posted 反映
//      エラー時は「どこで失敗したか」が分かるメッセージを返す。
//      URLはご指定フォーマット https://www.threads.com/@{accountId}/post/{postId}

import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postToThreads, getThreadsPermalink } from "@/lib/threads";

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

    // 予約行を取得
    const got = await ddb.send(
      new GetItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
      })
    );
    const it = got.Item;
    if (!it || it.isDeleted?.BOOL) {
      res.status(404).json({ error: "scheduled_not_found" }); // [MOD] 原因が分かる文言
      return;
    }
    if ((it.status?.S || "scheduled") === "posted") {
      res.status(409).json({ error: "already_posted" });
      return;
    }
    const content = it.content?.S || "";
    const accountId = it.accountId?.S || ""; // ハンドル（URL生成に使用）
    if (!content || !accountId) {
      res.status(400).json({ error: "invalid_item" });
      return;
    }

    // Threads資格情報（アクセストークン）
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


    // 実投稿（/me/threads -> /me/threads_publish）
    let postId = "";
    try {
      const r = await postToThreads({ accessToken, text: content });
      postId = r.postId;
    } catch (e: any) {
      res.status(502).json({ error: String(e?.message || e) });
      return;
    }
    if (!postId) {
      res.status(502).json({ error: "threads_post_failed" });
      return;
    }

    // [ADD] 公開URLを取得（API → 失敗時は postId→shortcode 変換）
    const { url: postUrl } = await getThreadsPermalink({
      accessToken,
      postId,
      handle: accountId, // ハンドル
    });

    const now = Math.floor(Date.now() / 1000);

    await ddb.send(
      new UpdateItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
        UpdateExpression:
          "SET #st=:posted, postedAt=:ts, postId=:pid, threadsPostId=:pid, postUrl=:purl",
        ConditionExpression:
          "(attribute_not_exists(#st) OR #st <> :posted) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":posted": { S: "posted" },
          ":ts": { N: String(now) },
          ":pid": { S: postId },
          ":purl": { S: postUrl }, // ← 正しいURL（shortcode付き）
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
