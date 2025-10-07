import { createDynamoClient } from '@/lib/ddb';
import { QueryCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { getTokenForAccount, deleteThreadsPostWithToken } from '@/lib/threads-delete';
import { fetchThreadsPosts } from '@/lib/fetch-threads-posts';
import { putLog } from '@/lib/logger';

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

  // Primary: fetch latest posted thread IDs from Threads API (numeric IDs)
  const threads = await fetchThreadsPosts({ userId, accountId: accountId || '', limit });
  const fetchedCount = Array.isArray(threads) ? threads.length : 0;
  console.info('[delete-user-posts] fetched threads', { userId, accountId: accountId || '', fetchedCount });

  // Build mapping from postId -> SK by querying ScheduledPosts once
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_SCHEDULED,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}` },
      ':pfx': { S: 'SCHEDULEDPOST#' },
    },
  }));
  const items = (((q as unknown) as { Items?: Array<Record<string, unknown>> }).Items) || [];
  const idToSk: Record<string, string> = {};
  for (const it of items) {
    const numeric = getSAttr(it?.numericPostId) || getSAttr(it?.postId) || '';
    const sk = getSAttr(it?.SK) || '';
    const status = getSAttr(it?.status) || '';
    const isDeleted = getBAttr(it?.isDeleted) === true;
    const itemAccountId = getSAttr(it?.accountId) || '';
    // If accountId filter provided, only map SKs for that account
    if (numeric && sk && !idToSk[numeric] && status === 'posted' && !isDeleted) {
      if (accountId && accountId !== '' && itemAccountId !== accountId) {
        continue;
      }
      idToSk[String(numeric)] = sk;
    }
  }

  // Map fetched Threads posts to posts list, attaching SK when available
  const posts: Array<{ sk?: string; postId: string; accountId?: string; createdAt?: number; raw?: Record<string, unknown> }> = (threads || []).map((t) => ({ postId: String(t.id), sk: idToSk[String(t.id)] }));
  console.info('[delete-user-posts] idToSk map sample', Object.keys(idToSk).slice(0, 20));
  console.info('[delete-user-posts] mapped posts sample', posts.slice(0, 20));

  const toDelete = posts.slice(0, limit);
  let deletedCount = 0;

  // If caller requests dryRun, return counts without performing deletions (for verification)
  if (dryRun) {
    const totalCandidates = posts.length;
    const fetchedCount = toDelete.length;
    const remaining = totalCandidates > fetchedCount;
    const webhook = process.env.MASTER_DISCORD_WEBHOOK || process.env.DISCORD_MASTER_WEBHOOK || '';
    if (webhook) {
      const payload = { content: `DeletionDryRun user=${userId} account=${accountId || 'N/A'} totalCandidates=${totalCandidates} fetchedCount=${fetchedCount} remaining=${remaining}` };
      await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
    }
    return { deletedCount: 0, remaining, totalCandidates, fetchedCount };
  }

  // Proceed to perform real deletions below.

  // Use token reuse strategy: fetch token once per account and reuse for successive deletions
  let currentAccountForToken: string | null = null;
  let currentToken: string | null = null;

  for (const p of toDelete) {
    console.info('[delete-user-posts] processing candidate', { userId, accountId: accountId || p.accountId || '', postId: p.postId, sk: p.sk });
    const acct = accountId || p.accountId || '';
    try {
      if (!acct) throw new Error('accountId required for deletion');
      if (acct !== currentAccountForToken) {
        // obtain token for this account once
        currentToken = await getTokenForAccount({ userId, accountId: acct });
        if (!currentToken) {
          await putLog({ userId, accountId: acct, action: 'deletion', status: 'error', message: 'missing_access_token' });
          throw new Error('missing_access_token');
        }
        currentAccountForToken = acct;
      }

      // perform deletion with retry/backoff for transient errors
      let attempt = 0;
      while (true) {
        attempt++;
      try {
        await deleteThreadsPostWithToken({ postId: p.postId, token: currentToken! });
        console.info('[delete-user-posts] threads delete success', { userId, accountId: acct, postId: p.postId });
        break; // success
      } catch (err: unknown) {
        console.warn('[delete-user-posts] threads delete failed', { userId, accountId: acct, postId: p.postId, error: stringifyError(err) });
          const msg = stringifyError(err);
          const fatal = isFatalThreadsError(msg);
          // Log attempt result
          await putLog({ userId, accountId: acct, action: 'deletion_attempt', status: fatal ? 'error' : 'warn', message: fatal ? 'deletion_fatal_error' : 'deletion_transient_error', detail: { postId: p.postId, sk: p.sk, attempt, error: msg } });
          if (fatal) {
            // fatal error - stop processing and escalate
            // If error indicates non-existent post (error_subcode 33), treat as success: mark DB record as deleted and continue
            try {
              const parsed = JSON.parse(msg.replace(/^.*?\{/, '{'));
              const errBody = parsed?.error;
              if (errBody && (errBody.error_subcode === 33 || /does not exist/.test(errBody.message || ''))) {
                // mark as deleted if possible and continue
            if (p.sk) {
                  const key = { PK: { S: `USER#${userId}` }, SK: { S: String(p.sk) } };
                  const now = Math.floor(Date.now() / 1000);
                  await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: key, UpdateExpression: 'SET isDeleted = :t, deletedAt = :ts', ExpressionAttributeValues: { ':t': { BOOL: true }, ':ts': { N: String(now) } } }));
                  console.info('[delete-user-posts] mark scheduled as deleted (post not found)', { userId, accountId: acct, postId: p.postId, sk: p.sk });
                }
                deletedCount++;
                break;
              }
            } catch (_) {
              // parsing failed - fall through to throwing
            }
            throw new Error(msg);
          }
          if (attempt >= MAX_DELETE_RETRIES) {
            // exceeded retries
            await putLog({ userId, accountId: acct, action: 'deletion', status: 'error', message: 'delete_failed_max_retries', detail: { postId: p.postId, sk: p.sk, attempts: attempt } });
            throw new Error(`delete_failed_max_retries: ${msg}`);
          }
          // exponential backoff
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await sleep(backoffMs);
          continue;
        }
      }

      if (p.sk) {
        const key = { PK: { S: `USER#${userId}` }, SK: { S: String(p.sk) } };
        const now = Math.floor(Date.now() / 1000);
        await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: key, UpdateExpression: 'SET isDeleted = :t, deletedAt = :ts', ExpressionAttributeValues: { ':t': { BOOL: true }, ':ts': { N: String(now) } } }));
        console.info('[delete-user-posts] mark scheduled as deleted (success)', { userId, accountId: p.accountId || accountId || '', postId: p.postId, sk: p.sk });
      }

      deletedCount++;
    } catch (err: unknown) {
      const errMsg = stringifyError(err);
      await putLog({ userId, accountId: acct, action: 'deletion', status: 'error', message: errMsg, detail: { postId: p.postId, sk: p.sk } });
      throw new Error(errMsg);
    }
  }

  // Determine remaining: if DB/posts list has more than we processed OR
  // if we fetched exactly `limit` items from Threads, there may be more remaining.
  let remaining = posts.length > toDelete.length;
  try {
    const cfgLimit = Number(limit || 0) || 0;
    // debug logs removed
    // If we fetched at least the configured limit and deleted the same number,
    // re-fetch one item to confirm whether more posts remain on Threads.
    if (fetchedCount > 0 && cfgLimit > 0 && fetchedCount >= cfgLimit && deletedCount === fetchedCount) {
      // perform an extra fetch to confirm remaining items; on failure, throw to propagate error
      const extra = await fetchThreadsPosts({ userId, accountId: accountId || '', limit: 1 });
      if (Array.isArray(extra) && extra.length > 0) {
        remaining = true;
      } else {
        remaining = false;
      }
    } else if (!remaining && fetchedCount > 0 && cfgLimit > 0 && fetchedCount >= cfgLimit) {
      // fallback heuristic: assume remaining if fetched == limit
      remaining = true;
    }
  } catch (e) {
    console.error('[delete-user-posts] remaining confirm fetch failed', String(e));
    throw e;
  }

  // If we fetched fewer posts than the requested limit, perform cleanup: physically delete all scheduled posts for this account
  try {
    if (fetchedCount > 0 && fetchedCount < (limit || 0)) {
      // debug logs removed
      // query scheduled posts for this user and delete only those that belong to the target account
      const qAll = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        ExpressionAttributeValues: {
          ':pk': { S: `USER#${userId}` },
          ':pfx': { S: 'SCHEDULEDPOST#' },
        },
        ProjectionExpression: 'PK,SK,accountId'
      }));
      const itemsAll = (((qAll as unknown) as { Items?: Array<Record<string, unknown>> }).Items) || [];
      for (const it of itemsAll) {
        const sk = getSAttr(it?.SK);
        const itemAccountId = getSAttr(it?.accountId) || '';
        console.info('[delete-user-posts] cleanup candidate', { userId, sk, itemAccountId });
        if (!sk) continue;
        // Only delete if this record belongs to the requested account (if provided)
        if (accountId && accountId !== '' && itemAccountId !== accountId) continue;
        try {
          await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: sk } } }));
        } catch (e) {
          console.warn('[delete-user-posts] failed to delete scheduled item', sk, String(e));
        }
      }

      // Re-fetch posts once to check if any remain on Threads side
      try {
        const remainingThreads = await fetchThreadsPosts({ userId, accountId: accountId || '', limit: limit || 100 });
        if (Array.isArray(remainingThreads) && remainingThreads.length > 0) {
          const msg = `delete_user_posts: cleanup incomplete, ${remainingThreads.length} posts remain for account=${accountId}`;
          console.warn(msg);
          await putLog({ userId, accountId: accountId || '', action: 'deletion_cleanup', status: 'warn', message: msg });
          // send discord notification if configured
          const webhook = process.env.MASTER_DISCORD_WEBHOOK || process.env.DISCORD_MASTER_WEBHOOK || '';
          if (webhook) {
            await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: msg }) }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[delete-user-posts] post-cleanup fetchThreadsPosts failed', String(e));
      }
    }
  } catch (e) {
    console.warn('[delete-user-posts] cleanup stage failed', String(e));
  }

  return { deletedCount, remaining, totalCandidates: posts.length, fetchedCount };
}


