// src/pages/api/dashboard-stats.ts
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
// 【追加】ダッシュボード用サマリ＆最近のエラー取得API
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
import type { NextApiRequest, NextApiResponse } from 'next';
import { DynamoDBClient, QueryCommand, QueryCommandInput } from '@aws-sdk/client-dynamodb';
import jwt from 'jsonwebtoken'; // 【追加】Cookie/JWTからuserId抽出に使用

// 【追加】Amplify Gen1 用クレデンシャル（既存方針に合わせて直指定）
const ddb = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

// 【追加】Cookieをパースするユーティリティを追加
function parseCookies(cookieHeader?: string | string[]) {
  const cookie = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : (cookieHeader || '');
  const map = new Map<string, string>();
  if (!cookie) return map;
  for (const kv of cookie.split(';').map(s => s.trim())) {
    const [k, ...rest] = kv.split('=');
    map.set(k, decodeURIComponent(rest.join('=')));
  }
  return map;
}

// 【追加】Cookie取得ヘルパ（ai-gateway.tsの方針に合わせて簡易実装）
function getCookie(req: NextApiRequest, name: string): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  for (const kv of cookie.split(';').map(s => s.trim())) {
    const [k, ...rest] = kv.split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// 【修正】ユーザーID抽出ロジックを、他APIと同一仕様に統一（idToken → sub / cognito:username）
function getUserIdFromRequest(req: NextApiRequest): string | null {
  // 1) Cookie の idToken を最優先で取得（/api/auth/login.ts と同一挙動）
  const cookies = parseCookies(req.headers.cookie);
  const idToken = cookies.get('idToken');
  if (idToken) {
    try {
      const decoded: any = jwt.decode(idToken);
      // 他APIと同じ優先順（/api/threads-accounts.ts）
      return decoded?.sub || decoded?.['cognito:username'] || null;
    } catch {
      // 無効トークンは次の手段へ
    }
  }

  // 2) フォールバック：Authorization: Bearer <token>（ローカル確認や将来拡張用）
  const auth = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : undefined;
  if (auth) {
    try {
      const decoded: any = jwt.decode(auth);
      return decoded?.sub || decoded?.['cognito:username'] || decoded?.userId || null;
    } catch {
      /* noop */
    }
  }

  return null; // 見つからなければ未認証
}

// 【追加】数値変換
const toNum = (v: any) => (typeof v === 'string' ? Number(v) : (v || 0));

// 【追加】Query共通（PK=USER#<userId> / begins_with指定）
async function queryByPrefix(tableName: string, userId: string, skPrefix: string, extra?: Partial<QueryCommandInput>) {
  const input: QueryCommandInput = {
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}` },
      ':sk': { S: skPrefix },
    },
    ...extra,
  };
  return await ddb.send(new QueryCommand(input));
}

// 【追加】当日0:00と23:59のUNIX秒を計算（JST=+9:00前提）
function getTodayRangeEpochJST(now = new Date()) {
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const d = jstNow.getUTCDate();
  const start = Date.UTC(y, m, d, 0, 0, 0) / 1000 - 9 * 3600;
  const end   = Date.UTC(y, m, d, 23, 59, 59) / 1000 - 9 * 3600;
  return { start, end };
}

// 【追加】当月範囲
function getThisMonthRangeEpochJST(now = new Date()) {
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const start = Date.UTC(y, m, 1, 0, 0, 0) / 1000 - 9 * 3600;
  const end   = Date.UTC(y, m + 1, 0, 23, 59, 59) / 1000 - 9 * 3600;
  return { start, end };
}

// 【追加】直近7日
function getLast7DaysEpoch(now = new Date()) {
  const end = Math.floor(now.getTime() / 1000);
  const start = end - 7 * 24 * 3600;
  return { start, end };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: userId not found in token' });
  }

  try {
    const { start: todayStart, end: todayEnd } = getTodayRangeEpochJST();
    const { start: monthStart, end: monthEnd } = getThisMonthRangeEpochJST();
    const { start: last7Start } = getLast7DaysEpoch();

    // ▼ アカウント
    const accResp = await queryByPrefix('ThreadsAccounts', userId, 'ACCOUNT#');
    const accounts = accResp.Items ?? [];
    const accountCount = accounts.length;
    const errorAccountCount = accounts.filter(a => {
      const msg = a.statusMessage?.S ?? '';
      return msg && msg.trim().length > 0; // 【追加】statusMessageに何か入っていればエラー扱い
    }).length;

    // ▼ 予約投稿（全件Query→Filter）※必要に応じてGSI最適化
    const spResp = await queryByPrefix('ScheduledPosts', userId, 'SCHEDULEDPOST#', { ScanIndexForward: false });
    const posts = spResp.Items ?? [];

    const notDeleted = posts.filter(p => p.isDeleted?.BOOL !== true);

    const scheduledCount = notDeleted.filter(p => p.status?.S === 'scheduled').length;
    const failedPostCount = notDeleted.filter(p => p.status?.S === 'failed').length;

    const todaysPostedCount = notDeleted.filter(p => {
      const postedAt = toNum(p.postedAt?.N);
      return postedAt >= todayStart && postedAt <= todayEnd && p.status?.S === 'posted';
    }).length;

    const todaysRemainingScheduled = notDeleted.filter(p => {
      const scheduledAt = toNum(p.scheduledAt?.N);
      return p.status?.S === 'scheduled' && scheduledAt >= Math.floor(Date.now() / 1000) && scheduledAt <= todayEnd;
    }).length;

    // 今月成功率
    const monthPosted = notDeleted.filter(p => {
      const postedAt = toNum(p.postedAt?.N);
      return postedAt >= monthStart && postedAt <= monthEnd && p.status?.S === 'posted';
    }).length;
    const monthFailed = notDeleted.filter(p => {
      const postedAt = toNum(p.postedAt?.N);
      // 投稿失敗はpostedAt=0もあり得るのでperiodはscheduledAtも見るが簡易に全期間failedを加算
      return p.status?.S === 'failed' && (postedAt === 0 || (postedAt >= monthStart && postedAt <= monthEnd));
    }).length;
    const monthSuccessRate = (monthPosted + monthFailed) > 0
      ? Math.round((monthPosted / (monthPosted + monthFailed)) * 100)
      : 100;

    // ▼ リプライ
    const rpResp = await queryByPrefix('Replies', userId, 'REPLY#', { ScanIndexForward: false });
    const replies = rpResp.Items ?? [];

    const unrepliedCount = replies.filter(r => r.status?.S === 'unreplied').length;
    const repliedCount   = replies.filter(r => r.status?.S === 'replied').length;
    const failedReplyCount = replies.filter(r => r.status?.S === 'failed').length;

    // ▼ 最近のエラー（直近7日 / 最大20件 / 種別タブ用にtype付与）
    const recentErrors: Array<{
      type: 'post' | 'reply' | 'account',
      id: string,
      at: number,
      message: string
    }> = [];

    // 投稿失敗
    notDeleted.forEach(p => {
      const createdAt = toNum(p.createdAt?.N);
      if (p.status?.S === 'failed' && createdAt >= last7Start) {
        recentErrors.push({
          type: 'post',
          id: p.scheduledPostId?.S || p.SK?.S || '',
          at: createdAt,
          message: `投稿失敗: ${p.content?.S?.slice(0, 60) || ''}`
        });
      }
    });

    // リプ失敗
    replies.forEach(r => {
      const createdAt = toNum(r.createdAt?.N);
      if (r.status?.S === 'failed' && createdAt >= last7Start) {
        recentErrors.push({
          type: 'reply',
          id: r.SK?.S || '',
          at: createdAt,
          message: r.errorDetail?.S || '返信失敗'
        });
      }
    });

    // アカウントエラー
    accounts.forEach(a => {
      const createdAt = toNum(a.createdAt?.N);
      const msg = a.statusMessage?.S ?? '';
      if (msg && createdAt >= last7Start) {
        recentErrors.push({
          type: 'account',
          id: a.SK?.S || '',
          at: createdAt,
          message: msg
        });
      }
    });

    recentErrors.sort((a, b) => b.at - a.at);
    const recentErrorsTop = recentErrors.slice(0, 20);

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
      recentErrors: recentErrorsTop
    });
  } catch (e: any) {
    return res.status(500).json({ message: 'Internal Error', detail: e?.message || String(e) });
  }
}
