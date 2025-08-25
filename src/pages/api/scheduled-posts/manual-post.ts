// /src/pages/api/scheduled-posts/manual-post.ts
// [MOD] permalink 取得に失敗した場合は postUrl を保存しない（他の項目のみ更新）
//      レスポンスも postUrl を省略（フロントはプロフィールリンクへフォールバック）

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

    // 予約行
    const got = await ddb.send(
      new GetItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
      })
    );
    const it = got.Item;
    if (!it || it.isDeleted?.BOOL) return res.status(404).json({ error: "scheduled_not_found" });
    if ((it.status?.S || "scheduled") === "posted") return res.status(409).json({ error: "already_posted" });

    const content = it.content?.S || "";
    const accountId = it.accountId?.S || ""; // ハンドル（プロフィールURL用）
    if (!content || !accountId) return res.status(400).json({ error: "invalid_item" });

    // Threads 資格情報とアカウント設定（providerUserIdも取得）
    const acct = await ddb.send(
      new GetItemCommand({
        TableName: TBL_THREADS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        ProjectionExpression: "accessToken, providerUserId, secondStageContent",
      })
    );
    const accessToken = acct.Item?.accessToken?.S || "";
    const providerUserId = acct.Item?.providerUserId?.S || "";
    const secondStageContent = acct.Item?.secondStageContent?.S || "";
    if (!accessToken) return res.status(400).json({ error: "missing_threads_credentials" });

    // 実投稿（GAS/Lambda準拠の送信先指定）
    const { postId, numericId } = await postToThreads({ 
      accessToken, 
      text: content,
      userIdOnPlatform: providerUserId 
    });

    // [MOD] permalink 取得（失敗時は null）
    const permalink = await getThreadsPermalink({ accessToken, postId });

    const now = Math.floor(Date.now() / 1000);

    // [MOD] UpdateExpression を動的に構築（postUrl は成功時のみ更新）
    const names = { "#st": "status" };
    const values: Record<string, any> = {
      ":posted": { S: "posted" },
      ":ts": { N: String(now) },
      ":pid": { S: postId },
      ":f": { BOOL: false },
    };
    const sets = ["#st = :posted", "postedAt = :ts", "postId = :pid"];
    
    // numericIdがあれば保存
    if (numericId) {
      values[":nid"] = { S: numericId };
      sets.push("numericPostId = :nid");
    }
    
    if (permalink?.url) {
      sets.push("postUrl = :purl");
      values[":purl"] = { S: permalink.url };
    }
    
    // 二段階投稿の初期化
    if (secondStageContent && secondStageContent.trim()) {
      sets.push("doublePostStatus = :waiting");
      values[":waiting"] = { S: "waiting" };
    }

    await ddb.send(
      new UpdateItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression:
          "(attribute_not_exists(#st) OR #st <> :posted) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );

    // [MOD] レスポンス：postUrl は取得できた場合のみ返す
    res.status(200).json({
      ok: true,
      post: {
        scheduledPostId,
        postId,
        ...(permalink?.url ? { postUrl: permalink.url } : {}),
        postedAt: now,
        status: "posted",
        ...(secondStageContent?.trim() ? { doublePostStatus: "waiting" } : {}),
      },
    });
  } catch (e: any) {
    res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}
