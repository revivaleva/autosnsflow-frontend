import { createDynamoClient } from '@/lib/ddb';
import { QueryCommand, DeleteItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { fetchThreadsPosts } from '@/lib/fetch-threads-posts';
import fetchUserReplies from '@/lib/fetch-user-replies';
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

  if (typeof limit === 'undefined' || limit === null) {
    try {
      const cfg = await import('@/lib/config');
      const v = cfg.getConfigValue('DELETION_BATCH_SIZE');
      limit = Number(v || '100') || 100;
    } catch (_) {
      limit = 100;
    }
  }

  let threads: any[] = [];
  try {
    threads = await fetchThreadsPosts({ userId, accountId, limit: limit as number });
    try {
      let providerUserId: string | undefined = undefined;
      try {
        const acct = await ddb.send(new GetItemCommand({ TableName: process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts', Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: 'providerUserId' }));
        providerUserId = acct?.Item?.providerUserId?.S || undefined;
      } catch (_) {}
      const replies = await fetchUserReplies({ userId, accountId, limit: limit as number, providerUserId });
      if (Array.isArray(replies) && replies.length > 0) {
        const existing = new Set((threads || []).map((x: any) => String(x.id)));
        for (const r of replies) {
          if (!existing.has(String(r.id))) threads.push(r);
        }
      }
    } catch (e) {
      try { console.warn('[warn] fetchUserReplies failed', { userId, accountId, error: String(e) }); } catch(_) {}
    }
    if (!Array.isArray(threads)) threads = [];
  } catch (e) {
    const msg = stringifyError(e);
    await putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'fetch_failed', detail: { error: msg } });
    throw new Error(`fetchThreadsPosts failed: ${msg}`);
  }

  let deletedCount = 0;
  let token: string | null = null;
  try {
    try { await putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'attempt_get_token' }); } catch (_) {}
    token = await getTokenForAccount({ userId, accountId });
    if (!token) {
      await putLog({ userId, accountId, action: 'deletion', status: 'warn', message: 'missing_oauth_access_token' });
      try { const tThreads = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts'; await ddb.send(new UpdateItemCommand({ TableName: tThreads, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET #st = :s', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'reauth_required' } } })); } catch(_) {}
      throw new Error('missing_oauth_access_token');
    }
    try { await putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'got_token', detail: { tokenPreview: token ? `len=${String(token.length)}` : null } }); } catch (_) {}
  } catch (e) {
    const msg = stringifyError(e);
    await putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'failed_read_account_token', detail: { error: msg } });
    throw e;
  }

  for (const t of threads.slice(0, limit)) {
    const postId = String(t.id || t.postId || t.numericPostId || '');
    if (!postId) continue;
    try {
      try { await putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'deleting_post', detail: { postId } }); } catch (_) {}
      await deleteThreadsPostWithToken({ postId, token });
      try { await putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'deleted_post', detail: { postId } }); } catch (_) {}
    } catch (err) {
      const msg = stringifyError(err);
      if (isMissingPostError(msg)) {
        // treat missing post as deleted
      } else {
        console.warn('[delete-posts-for-account] threads delete failed', { userId, accountId, postId, error: msg });
        if (/threads_delete_failed:\s*4\d\d/.test(msg) || msg.includes('missing_access_token')) {
          await putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'delete_failed', detail: { postId, error: msg } });
          throw new Error(msg);
        }
        throw new Error(msg);
      }
    }

    try {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':acc': { S: accountId }, ':f': { BOOL: false }, ':pid': { S: postId }, ':pidN': { N: postId } },
        FilterExpression: 'accountId = :acc AND (postId = :pid OR numericPostId = :pid OR numericPostId = :pidN) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)',
        ProjectionExpression: 'PK,SK,postId,numericPostId',
        Limit: 100,
      }));
      const foundItems = (q as any).Items || [];
      for (const it of foundItems) {
        const skToDel = it?.SK?.S;
        if (!skToDel) continue;
        try {
          await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: skToDel } } }));
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
  }

  let remaining = false;
  try {
    const extra = await fetchThreadsPosts({ userId, accountId, limit: 1 });
    remaining = Array.isArray(extra) && extra.length > 0;
  } catch (e) {
    const msg = stringifyError(e);
    console.warn('[delete-posts-for-account] remaining check fetch failed', { userId, accountId, error: msg });
    remaining = true;
  }

  if (!remaining) {
    try {
      try { await putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'final_cleanup_start' }); } catch(_) {}
      let lastKey: any = undefined;
      let totalDeletedRecords = 0;
      let totalFailedDeletes = 0;
      do {
        const qAll = await ddb.send(new QueryCommand({
          TableName: TBL_SCHEDULED,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
          ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':acc': { S: accountId } },
          FilterExpression: 'accountId = :acc',
          ProjectionExpression: 'PK,SK',
          ExclusiveStartKey: lastKey,
          Limit: 100,
        }));
        const items = (qAll as any).Items || [];
        for (const it of items) {
          const skToDel = it?.SK?.S;
          if (!skToDel) continue;
          try {
            const key = { PK: { S: `USER#${userId}` }, SK: { S: skToDel } };
            const resp = await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
            totalDeletedRecords++;
            try {
              const get = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
              const exists = Boolean(get && get.Item);
            } catch (ge) {
              try { console.warn('[warn] final_cleanup_verify_get failed', { userId, accountId, sk: skToDel, error: String(ge) }); } catch(_) {}
            }
          } catch (e) {
            totalFailedDeletes++;
            try { console.warn('[delete-posts-for-account] final cleanup delete failed', { userId, accountId, sk: skToDel, error: String(e) }); } catch(_) {}
          }
        }
        lastKey = (qAll as any).LastEvaluatedKey;
      } while (lastKey);
      try { await putLog({ userId, accountId, action: 'deletion', status: totalFailedDeletes > 0 ? 'error' : 'warn', message: 'final_cleanup_done', detail: { deletedCount, cleanedRecords: totalDeletedRecords, failedDeletes: totalFailedDeletes } }); } catch(_) {}
    } catch (e) {
      try { console.warn('[delete-posts-for-account] final cleanup failed', { userId, accountId, error: String(e) }); } catch(_) {}
    }
  }

  return { deletedCount, remaining };
}

export default deletePostsForAccount;


