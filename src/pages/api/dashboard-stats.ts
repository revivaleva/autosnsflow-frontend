// /src/pages/api/dashboard-stats.ts
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
// 【統一】ダッシュボード用サマリ＆最近のエラー取得API（Cognito検証＋Dynamo共通化）
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, QueryCommandInput } from "@aws-sdk/client-dynamodb";
// [ADD] サーバ専用ユーティリティ
import { createDynamoClient } from "@/lib/ddb";             // [ADD]
import { verifyUserFromRequest } from "@/lib/auth";         // [ADD]

// [ADD] 共有クライアント
const ddb = createDynamoClient();
// [ADD] テーブル名を環境変数化
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";
const TBL_POSTS   = process.env.TBL_SCHEDULED_POSTS  || "ScheduledPosts";
const TBL_REPLIES = process.env.TBL_REPLIES          || "Replies";

const toNum = (v: any) =>
  typeof v === "number" ? v : v?.N ? Number(v.N) : 0;      // [ADD]

function getTodayRangeEpochJST(now = new Date()) {
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const d = jstNow.getUTCDate();
  const start = Date.UTC(y, m, d, 0, 0, 0) / 1000 - 9 * 3600;
  const end   = Date.UTC(y, m, d, 23, 59, 59) / 1000 - 9 * 3600;
  return { start, end };
}
function getThisMonthRangeEpochJST(now = new Date()) {
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const start = Date.UTC(y, m, 1, 0, 0, 0) / 1000 - 9 * 3600;
  const end   = Date.UTC(y, m + 1, 0, 23, 59, 59) / 1000 - 9 * 3600;
  return { start, end };
}
function getLast7DaysEpoch(now = new Date()) {
  const end = Math.floor(now.getTime() / 1000);
  const start = end - 7 * 24 * 3600;
  return { start, end };
}
async function queryByPrefix(tableName: string, userId: string, skPrefix: string, extra?: Partial<QueryCommandInput>) {
  const input: QueryCommandInput = {
    TableName: tableName,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":sk": { S: skPrefix } },
    ...extra,
  };
  return await ddb.send(new QueryCommand(input));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ message: "Method Not Allowed" });

    // [ADD] 認証（Cookie/Bearer IdToken 検証）
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    const { start: todayStart, end: todayEnd } = getTodayRangeEpochJST();
    const { start: monthStart, end: monthEnd } = getThisMonthRangeEpochJST();
    const { start: last7Start } = getLast7DaysEpoch();
    const nowEpoch = Math.floor(Date.now() / 1000);

    // ▼ アカウント
    const accResp = await queryByPrefix(TBL_THREADS, userId, "ACCOUNT#");
    const accounts = accResp.Items ?? [];
    const accountCount = accounts.length;
    const errorAccountCount = accounts.filter(a => (a.statusMessage?.S ?? "").trim().length > 0).length;

    // ▼ 予約投稿
    const spResp = await queryByPrefix(TBL_POSTS, userId, "SCHEDULEDPOST#", { ScanIndexForward: false });
    const posts = (spResp.Items ?? []).filter(p => p.isDeleted?.BOOL !== true);

    const scheduledCount = posts.filter(p => p.status?.S === "scheduled").length;
    const failedPostCount = posts.filter(p => p.status?.S === "failed").length;

    const todaysPostedCount = posts.filter(p => {
      const postedAt = toNum(p.postedAt);
      return postedAt >= todayStart && postedAt <= todayEnd && p.status?.S === "posted";
    }).length;

    const todaysRemainingScheduled = posts.filter(p => {
      const scheduledAt = toNum(p.scheduledAt);
      return p.status?.S === "scheduled" && scheduledAt >= nowEpoch && scheduledAt <= todayEnd;
    }).length;

    const monthPosted = posts.filter(p => {
      const postedAt = toNum(p.postedAt);
      return postedAt >= monthStart && postedAt <= monthEnd && p.status?.S === "posted";
    }).length;
    const monthFailed = posts.filter(p => {
      const postedAt = toNum(p.postedAt);
      return p.status?.S === "failed" && (postedAt === 0 || (postedAt >= monthStart && postedAt <= monthEnd));
    }).length;
    const monthSuccessRate = (monthPosted + monthFailed) > 0
      ? Math.round((monthPosted / (monthPosted + monthFailed)) * 100)
      : 100;

    // ▼ リプライ
    const rpResp = await queryByPrefix(TBL_REPLIES, userId, "REPLY#", { ScanIndexForward: false });
    const replies = rpResp.Items ?? [];
    const unrepliedCount   = replies.filter(r => r.status?.S === "unreplied").length;
    const repliedCount     = replies.filter(r => r.status?.S === "replied").length;
    const failedReplyCount = replies.filter(r => r.status?.S === "failed").length;

    // ▼ 最近のエラー（直近7日 / 最大20件）
    const recentErrors: Array<{ type: "post" | "reply" | "account"; id: string; at: number; message: string }> = [];

    posts.forEach(p => {
      const createdAt = toNum(p.createdAt);
      if (p.status?.S === "failed" && createdAt >= last7Start) {
        recentErrors.push({
          type: "post",
          id: p.scheduledPostId?.S || p.SK?.S || "",
          at: createdAt,
          message: `投稿失敗: ${p.content?.S?.slice(0, 60) || ""}`,
        });
      }
    });
    replies.forEach(r => {
      const createdAt = toNum(r.createdAt);
      if (r.status?.S === "failed" && createdAt >= last7Start) {
        recentErrors.push({
          type: "reply",
          id: r.SK?.S || "",
          at: createdAt,
          message: r.errorDetail?.S || "返信失敗",
        });
      }
    });
    accounts.forEach(a => {
      const createdAt = toNum(a.createdAt);
      const msg = a.statusMessage?.S ?? "";
      if (msg && createdAt >= last7Start) {
        recentErrors.push({
          type: "account",
          id: a.SK?.S || "",
          at: createdAt,
          message: msg,
        });
      }
    });

    recentErrors.sort((a, b) => b.at - a.at);

    return res.status(200).json({
      accountCount,
      scheduledCount,
      todaysPostedCount,
      unrepliedCount,
      repliedCount,
      errorAccountCount,
      failedPostCount,
      todaysRemainingScheduled,
      monthSuccessRate,
      recentErrors: recentErrors.slice(0, 20),
    });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ message: e?.message || "internal_error" });
  }
}
