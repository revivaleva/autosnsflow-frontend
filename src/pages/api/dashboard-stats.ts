// /src/pages/api/dashboard-stats.ts
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
// 【統一】ダッシュボード用サマリ＆最近のエラー取得API（Cognito検証＋Dynamo共通化）
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, QueryCommandInput, ScanCommand } from "@aws-sdk/client-dynamodb";
// [ADD] サーバ専用ユーティリティ
import { createDynamoClient } from "@/lib/ddb";             // [ADD]
import { verifyUserFromRequest } from "@/lib/auth";         // [ADD]

// [ADD] 共有クライアント
const ddb = createDynamoClient();
// [ADD] テーブル名を環境変数化
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";
const TBL_POSTS   = process.env.TBL_SCHEDULED_POSTS  || "ScheduledPosts";
const TBL_REPLIES = process.env.TBL_REPLIES          || "Replies";
// ExecutionLogs table (optional)
const TBL_EXECUTION_LOGS = process.env.TBL_EXECUTION_LOGS || process.env.LOG_TBL || 'ExecutionLogs';

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
    const recentErrors: Array<{
      type: "post" | "reply" | "account";
      id: string;
      at: number;
      message: string;
      accountId?: string;
      displayName?: string;
      scheduledAt?: number;
      contentSummary?: string;
    }> = [];

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

    // クイックマップ: recentErrors に displayName を差し込むためアカウント情報を参照
    const accountIdToDisplay: Record<string,string> = {};
    accounts.forEach(a => {
      const sk = a.SK?.S || '';
      const accountIdVal = a.accountId?.S || '';
      const usernameVal = a.username?.S || '';
      const display = a.displayName?.S || accountIdVal || sk.replace(/^ACCOUNT#/, '');
      if (sk) accountIdToDisplay[sk] = display;
      if (accountIdVal) accountIdToDisplay[accountIdVal] = display;
      if (usernameVal) accountIdToDisplay[usernameVal] = display;
    });
    // posts の内容（scheduledAt, content）を id -> info map に保存
    const postIdToInfo: Record<string, { scheduledAt?: number; content?: string; accountSk?: string } > = {};
    posts.forEach(p => {
      const id = p.scheduledPostId?.S || p.SK?.S || '';
      const acctSk = p.accountId?.S || (p.accountId?.S ? p.accountId.S : undefined) || '';
      postIdToInfo[id] = { scheduledAt: toNum(p.scheduledAt) || undefined, content: p.content?.S?.slice(0, 400) || undefined, accountSk: acctSk || undefined };
      // Key by both raw id and without prefix
      if (id.startsWith('SCHEDULEDPOST#')) postIdToInfo[id.replace(/^SCHEDULEDPOST#/, '')] = postIdToInfo[id];
    });

    // recentErrors will be enriched after we also merge ExecutionLogs below

    // ▼ ExecutionLogs (オプション) - 直近7日分を取得し recentErrors にマージする
    try {
      const qResp = await queryByPrefix(TBL_EXECUTION_LOGS, userId, 'LOG#', { ScanIndexForward: false, Limit: 100 } as any);
      const logs = qResp.Items ?? [];
      logs.forEach(l => {
        try {
          const createdAt = toNum(l.createdAt) || Math.floor(Date.now() / 1000);
          if (createdAt < last7Start) return; // 7日より前は無視
          const rawType = (l.type?.S || 'system') as string;
          const mappedType: 'post' | 'reply' | 'account' = rawType.includes('post') ? 'post' : rawType.includes('reply') ? 'reply' : 'account';
          // detail は JSON 文字列の可能性があるためパースして message を作る
          let message = l.message?.S || '';
          try {
            const d = JSON.parse(l.detail?.S || '{}');
            if (typeof d === 'object' && d !== null) {
              if (!message && d.message) message = String(d.message).slice(0, 200);
            }
          } catch (_e) {}
          // マスク: アクセストークン等を含む可能性があるので一定のキーは除去
          message = message.replace(/accessToken\s*[:=]\s*\S+/ig, '[REDACTED]');
          // id は優先的に targetId (例: SCHEDULEDPOST#...) を使う
          const targetId = l.targetId?.S || '';
          const acctIdField = l.accountId?.S || l.accountId || '';
          const idForEntry = targetId || (l.SK?.S || '');
          recentErrors.push({ type: mappedType, id: idForEntry, at: createdAt, message: message || '(ログ)', accountId: acctIdField || undefined });
        } catch (_e) {}
      });
    } catch (e) {
      // ExecutionLogs が存在しない or 権限エラーなどの場合は無視して続行
      // 意図的にデバッグログの標準出力は残さない
    }

    // accountId-based Scan fallback removed per request (was causing reserved keyword projection issues)

    // Enrich recentErrors now that ExecutionLogs have been merged above
    const enriched = recentErrors.map(re => {
      let displayName = '';
      let accountId = '';
      if (re.type === 'account') {
        accountId = (re.id || '').replace(/^ACCOUNT#/, '');
        displayName = accountIdToDisplay[`ACCOUNT#${accountId}`] || accountIdToDisplay[accountId] || '';
      }
      const postInfo = postIdToInfo[re.id] || postIdToInfo[re.id?.replace(/^SCHEDULEDPOST#/, '') || ''];
      if (postInfo) {
        if (!accountId && postInfo.accountSk) accountId = postInfo.accountSk.replace(/^ACCOUNT#/, '');
        if (!displayName && postInfo.accountSk) displayName = accountIdToDisplay[postInfo.accountSk] || accountIdToDisplay[accountId] || '';
      }
      return Object.assign({}, re, { displayName: displayName || undefined, accountId: accountId || undefined, scheduledAt: postInfo?.scheduledAt, contentSummary: postInfo?.content ? (postInfo.content.length > 200 ? postInfo.content.slice(0,200) + '…' : postInfo.content) : undefined });
    });

    // ソートとレスポンス整形
    enriched.sort((a, b) => b.at - a.at);

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
      recentErrors: enriched.slice(0, 20),
    });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ message: e?.message || "internal_error" });
  }
}
