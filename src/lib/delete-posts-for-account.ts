import { createDynamoClient } from '@/lib/ddb';
import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { fetchThreadsPosts } from '@/lib/fetch-threads-posts';
import { getTokenForAccount, deleteThreadsPostWithToken } from '@/lib/threads-delete';
import { putLog } from '@/lib/logger';
import { deleteScheduledRecord } from '@/lib/scheduled-posts-delete';

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED || 'ScheduledPosts';

function stringifyError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === 'string') return maybe;
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

function isMissingPostError(msg: string) {
  if (!msg) return false;
  try {
    const j = JSON.parse(msg.replace(/^.*?\{/, '{'));
    const errBody = j?.error;
    if (errBody && (errBody.error_subcode === 33)) return true;
    if (typeof j?.raw === 'string' && (j.raw.includes('does not exist') || j.raw.includes('cannot be loaded'))) return true;
  } catch (_) {}
  if (msg.includes('does not exist') || msg.includes('cannot be loaded')) return true;
  return false;
}

export async function deletePostsForAccount({ userId, accountId, limit }: { userId: string; accountId: string; limit?: number }): Promise<{ deletedCount: number; remaining: boolean }> {
  if (!userId) throw new Error('userId required');
  if (!accountId) throw new Error('accountId required');

  // determine limit
  if (typeof limit === 'undefined' || limit === null) {
    try {
      const cfg = await import('@/lib/config');
      const v = cfg.getConfigValue('DELETION_BATCH_SIZE');
      limit = Number(v || '100') || 100;
    } catch (_) {
      limit = 100;
    }
  }

  // Fetch from Threads API - if this fails, record and abort
  let threads: any[] = [];
  try {
    threads = await fetchThreadsPosts({ userId, accountId, limit: limit as number });
    if (!Array.isArray(threads)) threads = [];
    console.info('[delete-posts-for-account] fetched threads', { userId, accountId, fetched: threads.length });
    try {
      const ids = (threads || []).map(t => String(t.id || t.postId || t.numericPostId)).slice(0, 50);
      console.info('[delete-posts-for-account] fetched threads sample', { userId, accountId, sampleCount: ids.length, ids });
    } catch (_) {}
  } catch (e) {
    const msg = stringifyError(e);
    await putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'fetch_failed', detail: { error: msg } });
    throw new Error(`fetchThreadsPosts failed: ${msg}`);
  }

  if (threads.length === 0) return { deletedCount: 0, remaining: false };

  let deletedCount = 0;
  // token reuse per account (accountId fixed here)
  let token: string | null = null;
  try {
    token = await getTokenForAccount({ userId, accountId });
    if (!token) {
      await putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'missing_access_token' });
      throw new Error('missing_access_token');
    }
  } catch (e) {
    const msg = stringifyError(e);
    await putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'failed_read_account_token', detail: { error: msg } });
    throw e;
  }

  for (const t of threads.slice(0, limit)) {
    const postId = String(t.id || t.postId || t.numericPostId || '');
    if (!postId) continue;
    try {
      try {
        const delResp = await deleteThreadsPostWithToken({ postId, token });
        console.info('[delete-posts-for-account] threads delete response', { userId, accountId, postId, resp: delResp?.status });
      } catch (err) {
        const msg = stringifyError(err);
        // treat missing post as success
        if (isMissingPostError(msg)) {
          console.info('[delete-posts-for-account] threads post missing - treat as deleted', { userId, accountId, postId });
        } else {
          // fatal (e.g., 4xx) or transient - escalate
          console.warn('[delete-posts-for-account] threads delete failed', { userId, accountId, postId, error: msg });
          // if fatal, log to ExecutionLogs
          if (/threads_delete_failed:\s*4\d\d/.test(msg) || msg.includes('missing_access_token')) {
            await putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'delete_failed', detail: { postId, error: msg } });
            throw new Error(msg);
          }
          // otherwise treat as transient - throw to allow retry by caller
          throw new Error(msg);
        }
      }

      // After external delete (or missing-case), remove scheduled record if exists
      try {
        // Query for any scheduled posts under this user that match the postId (string) or numericPostId (number)
        const q = await ddb.send(new QueryCommand({
          TableName: TBL_SCHEDULED,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
          ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':acc': { S: accountId }, ':f': { BOOL: false }, ':pid': { S: postId }, ':pidN': { N: postId } },
          FilterExpression: 'accountId = :acc AND (postId = :pid OR numericPostId = :pid OR numericPostId = :pidN) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)',
          ProjectionExpression: 'PK,SK,postId,numericPostId',
          Limit: 100,
        }));
        const foundItems = (q as any).Items || [];
        try { console.info('[delete-posts-for-account] scheduled lookup results', { userId, accountId, postId, matchCount: foundItems.length, items: foundItems.slice(0,20) }); } catch(_) {}
        // Delete all matched items by PK+SK
        for (const it of foundItems) {
          const skToDel = it?.SK?.S;
          if (!skToDel) continue;
          try {
            await ddb.send(new (require('@aws-sdk/client-dynamodb').DeleteItemCommand)({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: skToDel } } }));
            try { console.info('[delete-posts-for-account] deleted scheduled record', { userId, accountId, sk: skToDel }); } catch(_) {}
          } catch (e) {
            try { console.warn('[delete-posts-for-account] failed to delete scheduled record', { userId, accountId, sk: skToDel, error: String(e) }); } catch(_) {}
            throw e;
          }
        }
      } catch (e) {
        const msg = stringifyError(e);
        console.warn('[delete-posts-for-account] db cleanup failed', { userId, accountId, postId, error: msg });
        throw new Error(msg);
      }

      deletedCount++;
    } catch (e) {
      // propagate as fatal to caller
      throw e;
    }
  }

  // check remaining on Threads side
  let remaining = false;
  try {
    const extra = await fetchThreadsPosts({ userId, accountId, limit: 1 });
    remaining = Array.isArray(extra) && extra.length > 0;
  } catch (e) {
    const msg = stringifyError(e);
    console.warn('[delete-posts-for-account] remaining check fetch failed', { userId, accountId, error: msg });
    // on failure to confirm, assume remaining true to be safe
    remaining = true;
  }

  // if finished, log to ExecutionLogs summary
  if (!remaining) {
    await putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'deletion_completed', detail: { deletedCount } });
  }

  return { deletedCount, remaining };
}

export default deletePostsForAccount;


