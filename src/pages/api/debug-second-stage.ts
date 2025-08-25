// /src/pages/api/debug-second-stage.ts
// 二段階投稿のデバッグ用API（フロントエンド側で確認可能な情報を提供）
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_SETTINGS = "UserSettings";
const TBL_THREADS = "ThreadsAccounts";
const TBL_SCHEDULED = "ScheduledPosts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method === "POST") {
      // 1. ユーザー設定を取得
      const userSettings = await ddb.send(new GetItemCommand({
        TableName: TBL_SETTINGS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
        ProjectionExpression: "doublePostDelay, autoPost",
      }));

      const doublePostDelay = Number(userSettings.Item?.doublePostDelay?.N || "0");
      const autoPost = userSettings.Item?.autoPost?.BOOL || false;

      // 2. Threadsアカウント設定を取得
      const accountsQuery = await ddb.send(new QueryCommand({
        TableName: TBL_THREADS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "ACCOUNT#" },
        },
        ProjectionExpression: "SK, displayName, secondStageContent",
      }));

      const accounts = (accountsQuery.Items || []).map(item => ({
        accountId: String(item.SK?.S || "").replace("ACCOUNT#", ""),
        displayName: item.displayName?.S || "",
        hasSecondStageContent: !!(item.secondStageContent?.S?.trim()),
        secondStageContentLength: (item.secondStageContent?.S || "").length,
        secondStageContentRaw: item.secondStageContent?.S || null, // 実際の値を確認
        fullItemDebug: {
          SK: item.SK?.S,
          displayName: item.displayName?.S,
          secondStageContent: item.secondStageContent,
        }
      }));

      // 3. 最近の投稿のdoublePostStatus状況を確認
      const now = Math.floor(Date.now() / 1000);
      const last24Hours = now - (24 * 60 * 60);

      const recentPostsQuery = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        FilterExpression: "postedAt >= :since AND #st = :posted",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "SCHEDULEDPOST#" },
          ":since": { N: String(last24Hours) },
          ":posted": { S: "posted" },
        },
        ProjectionExpression: "SK, accountId, postedAt, doublePostStatus, autoPostGroupId",
        Limit: 10,
      }));

      const recentPosts = (recentPostsQuery.Items || []).map(item => ({
        scheduledPostId: String(item.SK?.S || "").replace("SCHEDULEDPOST#", ""),
        accountId: item.accountId?.S || "",
        postedAt: Number(item.postedAt?.N || "0"),
        doublePostStatus: item.doublePostStatus?.S || "未設定",
        autoPostGroupId: item.autoPostGroupId?.S || "",
        isAutoPost: (item.autoPostGroupId?.S || "").includes("自動投稿"),
      }));

      // 4. デバッグ情報をまとめて返却
      const debugInfo = {
        userSettings: {
          doublePostDelay,
          autoPost,
          isDelayValid: doublePostDelay > 0,
        },
        accounts: accounts,
        accountsWithSecondStage: accounts.filter(a => a.hasSecondStageContent),
        recentPosts: recentPosts,
        postsEligibleForSecondStage: recentPosts.filter(p => p.isAutoPost),
        summary: {
          totalAccounts: accounts.length,
          accountsWithSecondStageContent: accounts.filter(a => a.hasSecondStageContent).length,
          recentPostedCount: recentPosts.length,
          recentAutoPostCount: recentPosts.filter(p => p.isAutoPost).length,
          waitingSecondStage: recentPosts.filter(p => p.doublePostStatus === "waiting").length,
          completedSecondStage: recentPosts.filter(p => p.doublePostStatus === "done").length,
        },
        diagnosis: {
          delayConfigured: doublePostDelay > 0,
          hasAccountsWithContent: accounts.some(a => a.hasSecondStageContent),
          hasRecentAutoPost: recentPosts.some(p => p.isAutoPost),
          overallStatus: (() => {
            if (doublePostDelay <= 0) return "遅延時間が設定されていません";
            if (!accounts.some(a => a.hasSecondStageContent)) return "二段階投稿用テキストが設定されていません";
            if (!recentPosts.some(p => p.isAutoPost)) return "最近の自動投稿がありません";
            return "設定は正常です";
          })()
        }
      };

      return res.status(200).json({
        ok: true,
        userId,
        debugInfo,
        rawQueryResult: {
          accountsQueryItemCount: accountsQuery.Items?.length || 0,
          accountsQueryItems: accountsQuery.Items,
        }
      });
    }

    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    console.error("debug-second-stage error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: e?.message || "Unknown error",
      detail: e?.detail || {}
    });
  }
}
