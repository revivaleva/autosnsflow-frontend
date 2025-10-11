import { createDynamoClient } from '@/lib/ddb';
import { QueryCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { getTokenForAccount, deleteThreadsPostWithToken } from '@/lib/threads-delete';
import { fetchThreadsPosts } from '@/lib/fetch-threads-posts';
import { putLog } from '@/lib/logger';
import deletePostsForAccountWithAdapters from '@autosnsflow/shared';

const MAX_DELETE_RETRIES = Number(process.env.DELETION_API_RETRY_COUNT || '3');

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function isFatalThreadsError(errMsg: string) {
  if (!errMsg) return false;
  // treat 4xx errors from Threads API as fatal (permission / invalid post)
  const m = errMsg.match(/threads_delete_failed:\s*(\d{3})/);
  if (m) {
    const code = Number(m[1]);
    return code >= 400 && code < 500;
  }
  // treat missing token as fatal for this post
  if (errMsg.includes('missing_access_token')) return true;
  return false;
}

function stringifyError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === 'string') return maybe;
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED || 'ScheduledPosts';

// Helpers to read DynamoDB attribute shapes
const getSAttr = (a: unknown): string | undefined => {
  if (!a || typeof a !== 'object') return undefined;
  const obj = a as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(obj, 'S')) return undefined;
  const v = obj['S'];
  return typeof v === 'string' ? v : undefined;
};
const getBAttr = (a: unknown): boolean | undefined => {
  if (!a || typeof a !== 'object') return undefined;
  const obj = a as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(obj, 'BOOL')) return undefined;
  return Boolean(obj['BOOL']);
};

/**
 * Delete up to `limit` posted scheduled posts for a user (oldest first).
 * If `limit` is omitted, this function will read `DELETION_BATCH_SIZE` from AppConfig
 * (via `src/lib/config.ts`) and fall back to 100.
 */
export async function deleteUserPosts({ userId, accountId, limit, dryRun }: { userId: string; accountId?: string; limit?: number; dryRun?: boolean }): Promise<{ deletedCount: number; remaining: boolean; totalCandidates?: number; fetchedCount?: number }> {
  if (!userId) throw new Error('userId required');

  // If limit not provided, attempt to read from AppConfig.DELETION_BATCH_SIZE, fallback to 100
  if (typeof limit === 'undefined' || limit === null) {
    try {
      // lazy import to avoid circular dependency in some environments
      const cfgMod = await import('@/lib/config');
      const cfg = cfgMod as { getConfigValue: (k: string) => string | undefined };
      const v = cfg.getConfigValue('DELETION_BATCH_SIZE');
      limit = Number(v || '100') || 100;
    } catch (_: unknown) {
      limit = 100;
    }
  }

  // Delegate to unified deletePostsForAccount for actual deletion behavior.
  if (!accountId) throw new Error('accountId required');
  if (dryRun) {
    // dryRun: just fetch threads and return counts
    const threads = await fetchThreadsPosts({ userId, accountId: accountId || '', limit });
    const fetchedCount = Array.isArray(threads) ? threads.length : 0;
    const totalCandidates = fetchedCount;
    const remaining = totalCandidates > (limit || 0);
    const webhook = process.env.MASTER_DISCORD_WEBHOOK || process.env.DISCORD_MASTER_WEBHOOK || '';
    if (webhook) {
      const payload = { content: `DeletionDryRun user=${userId} account=${accountId || 'N/A'} totalCandidates=${totalCandidates} fetchedCount=${fetchedCount} remaining=${remaining}` };
      await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
    }
    return { deletedCount: 0, remaining, totalCandidates, fetchedCount };
  }

  // delegated to deletePostsForAccountWithAdapters via adapters built from frontend helpers
  const adapters = {
    fetchThreadsPosts: (opts: any) => fetchThreadsPosts(opts),
    fetchUserReplies: (opts: any) => import('@/lib/fetch-user-replies').then(m => (m.default ? m.default(opts) : m(opts))),
    getTokenForAccount: ({ userId, accountId }: any) => import('@/lib/threads-delete').then(m => m.getTokenForAccount({ userId, accountId })),
    deleteThreadsPostWithToken: ({ postId, token }: any) => import('@/lib/threads-delete').then(m => m.deleteThreadsPostWithToken({ postId, token })),
    getScheduledAccount: async ({ userId, accountId }: any) => {
      try {
        const res = await ddb.send(new QueryCommand({ TableName: process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts', KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } }, ProjectionExpression: 'providerUserId, SK' }));
        const items = (res as any).Items || [];
        for (const it of items) {
          const sk = it.SK?.S || '';
          const acc = sk.replace(/^ACCOUNT#/, '');
          if (acc === accountId) return { providerUserId: it.providerUserId?.S || undefined };
        }
      } catch (_) {}
      return null;
    },
    queryScheduled: async ({ userId, accountId, postId }: any) => {
      try {
        const q = await ddb.send(new QueryCommand({ TableName: process.env.TBL_SCHEDULED || 'ScheduledPosts', KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':acc': { S: accountId }, ':f': { BOOL: false }, ':pid': { S: postId }, ':pidN': { N: postId } }, FilterExpression: 'accountId = :acc AND (postId = :pid OR numericPostId = :pid OR numericPostId = :pidN) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)', ProjectionExpression: 'PK,SK', Limit: 100 }));
        const items = (q as any).Items || [];
        return items.map((it: any) => ({ PK: it.PK?.S || '', SK: it.SK?.S || '' }));
      } catch (e) { return []; }
    },
    deleteScheduledItem: async ({ PK, SK }: any) => {
      await ddb.send(new DeleteItemCommand({ TableName: process.env.TBL_SCHEDULED || 'ScheduledPosts', Key: { PK: { S: PK }, SK: { S: SK } } }));
    },
    getConfigValue: (k: string) => {
      try { const cfg = require('@/lib/config'); return cfg.getConfigValue(k); } catch(_) { return undefined; }
    },
    putLog: (entry: any) => putLog(entry),
  } as any;

  const res = await deletePostsForAccountWithAdapters({ userId, accountId: accountId!, limit }, adapters);
  return { deletedCount: res.deletedCount, remaining: res.remaining } as any;
}