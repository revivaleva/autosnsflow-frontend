// /src/pages/api/scheduled-posts/manual-post.ts
// [MOD] permalink 取得に失敗した場合は postUrl を保存しない（他の項目のみ更新）
//      レスポンスも postUrl を省略（フロントはプロフィールリンクへフォールバック）

import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postToThreads, postQuoteToThreads, getThreadsPermalink } from "@/lib/threads";

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
        ProjectionExpression: "accessToken, oauthAccessToken, providerUserId, secondStageContent",
      })
    );
    // Diagnostic: optional webhook debug output controlled by ALLOW_DEBUG_EXEC_LOGS
    try {
      const masterDiag = process.env.MASTER_DISCORD_WEBHOOK || process.env.DISCORD_MASTER_WEBHOOK || '';
      const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
      if (masterDiag && allowDebug) {
        const hasAccess = !!acct.Item?.accessToken?.S;
        const hasOauth = !!acct.Item?.oauthAccessToken?.S;
        const provider = acct.Item?.providerUserId?.S || '(none)';
        const diag = `manual-post diag - user=${userId} account=${accountId} hasAccessToken=${hasAccess} hasOauthAccessToken=${hasOauth} providerUserId=${provider}`;
        // use debug helper to gate external webhook as well
        // debug webhook removed
      }
    } catch (e) {
      console.warn('[manual-post] diag webhook failed', e);
    }
    const accessToken = acct.Item?.accessToken?.S || "";
    const oauthAccessToken = acct.Item?.oauthAccessToken?.S || "";
    const providerUserId = acct.Item?.providerUserId?.S || "";
    const secondStageContent = acct.Item?.secondStageContent?.S || "";
    if (!accessToken && !oauthAccessToken) return res.status(400).json({ error: "missing_threads_credentials" });

    // 実投稿（GAS/Lambda準拠の送信先指定）
    // Debug webhook removed

    // If this scheduled item is a quote, use the quote-specific create/publish flow
    const scheduledType = it.type?.S || '';
    let postId: string = '';
    let numericId: string | undefined;
    if (scheduledType === 'quote') {
      // Use numericPostId field only. If it's not present, fail early.
      const referenced = it.numericPostId?.S || '';
      if (!referenced) return res.status(400).json({ error: 'missing_referenced_post_id_for_quote' });
      const quoteResult = await postQuoteToThreads({
        accessToken: oauthAccessToken || accessToken,
        oauthAccessToken: oauthAccessToken || undefined,
        text: content,
        referencedPostId: String(referenced),
        userIdOnPlatform: providerUserId,
      });
      postId = quoteResult.postId || '';
      // persist numericId: use only numericId returned by publish
      numericId = quoteResult.numericId || undefined;
    } else {
      const normal = await postToThreads({ 
        accessToken, 
        oauthAccessToken: oauthAccessToken || undefined,
        text: content,
        userIdOnPlatform: providerUserId 
      });
      postId = normal.postId;
      // persist numericId: use only numericId returned by publish
      numericId = normal.numericId || undefined;
    }

    // [MOD] permalink 取得（失敗時は null）
    const permalink = await getThreadsPermalink({ accessToken: (oauthAccessToken && oauthAccessToken.trim()) ? oauthAccessToken : accessToken, postId });

    // Debug webhook removed

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
    } else {
      // Mark as attempted-and-failed so we don't retry fetching permalink repeatedly
      sets.push("postUrl = :purl");
      values[":purl"] = { S: '-' };
    }
    
    // 二段階投稿の初期化: アカウント設定に二段階投稿内容があっても、
    // 予約行側で secondStageWanted が false の場合は二段階投稿をスキップする
    const reservationSecondWanted = it.secondStageWanted?.BOOL;
    if (secondStageContent && secondStageContent.trim() && reservationSecondWanted !== false) {
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
