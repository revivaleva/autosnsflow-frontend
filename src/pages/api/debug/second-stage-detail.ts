// /src/pages/api/debug/second-stage-detail.ts
// 二段階投稿の詳細デバッグAPI
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

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

    // 予約投稿情報を詳細取得
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
    const postId = scheduledPost.Item.postId?.S;
    const numericPostId = scheduledPost.Item.numericPostId?.S;
    const doublePostStatus = scheduledPost.Item.doublePostStatus?.S;
    const status = scheduledPost.Item.status?.S;
    const content = scheduledPost.Item.content?.S;

    // アカウント情報詳細取得
    let accountInfo = null;
    if (accountId) {
      const accountItem = await ddb.send(new GetItemCommand({
        TableName: TBL_THREADS,
        Key: { 
          PK: { S: `USER#${userId}` }, 
          SK: { S: `ACCOUNT#${accountId}` }
        },
        ProjectionExpression: "accessToken, providerUserId, secondStageContent, displayName",
      }));
      
      if (accountItem.Item) {
        accountInfo = {
          accountId,
          displayName: accountItem.Item.displayName?.S || "",
          hasAccessToken: !!accountItem.Item.accessToken?.S,
          accessTokenLength: accountItem.Item.accessToken?.S?.length || 0,
          providerUserId: accountItem.Item.providerUserId?.S || "",
          secondStageContent: accountItem.Item.secondStageContent?.S || "",
          secondStageContentLength: accountItem.Item.secondStageContent?.S?.length || 0,
        };
      }
    }

    // Threads API テスト用情報
    const debugInfo: {
      scheduledPost: any;
      account: any;
      validation: any;
      diagnosis: any;
      testEndpoints?: any;
    } = {
      scheduledPost: {
        scheduledPostId,
        accountId,
        status,
        doublePostStatus,
        postId,
        numericPostId,
        content: content?.substring(0, 100) + "...",
        contentLength: content?.length || 0,
        rawItem: scheduledPost.Item, // 生データ
      },
      account: accountInfo,
      validation: {
        hasAccountId: !!accountId,
        hasPostId: !!postId,
        hasNumericPostId: !!numericPostId,
        isPosted: status === "posted",
        isWaiting: doublePostStatus === "waiting",
        hasSecondStageContent: !!accountInfo?.secondStageContent,
        hasProviderUserId: !!accountInfo?.providerUserId,
        hasAccessToken: !!accountInfo?.hasAccessToken,
      },
      diagnosis: {
        canPerformSecondStage: false,
        issues: [] as string[],
      }
    };

    // 診断実行
    const issues = [];
    if (!accountId) issues.push("accountId missing");
    if (status !== "posted") issues.push(`status is '${status}', not 'posted'`);
    if (doublePostStatus === "done") issues.push("second stage already completed");
    if (!postId && !numericPostId) issues.push("no postId or numericPostId");
    if (!accountInfo?.hasAccessToken) issues.push("no access token");
    if (!accountInfo?.providerUserId) issues.push("no providerUserId");
    if (!accountInfo?.secondStageContent) issues.push("no secondStageContent");

    debugInfo.diagnosis.issues = issues;
    debugInfo.diagnosis.canPerformSecondStage = issues.length === 0;

    // 推奨されるpostIDを決定
    const recommendedPostId = postId || numericPostId;
    
    // テスト用エンドポイント情報
    if (accountInfo?.providerUserId && recommendedPostId) {
      debugInfo.testEndpoints = {
        threadsCreateUrl: `https://graph.threads.net/v1.0/${encodeURIComponent(accountInfo.providerUserId)}/threads`,
        threadsPublishUrl: `https://graph.threads.net/v1.0/${encodeURIComponent(accountInfo.providerUserId)}/threads_publish`,
        replyTargetId: recommendedPostId,
        testPayload: {
          media_type: "TEXT",
          text: accountInfo.secondStageContent || "テスト投稿",
          replied_to_id: recommendedPostId,
          access_token: "***"
        }
      };
    }

    return res.status(200).json({
      ok: true,
      debugInfo,
      message: debugInfo.diagnosis.canPerformSecondStage 
        ? "二段階投稿実行可能"
        : `二段階投稿実行不可: ${issues.join(", ")}`
    });

  } catch (e: any) {
    console.error("debug second-stage-detail error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: e?.message || "Unknown error"
    });
  }
}
