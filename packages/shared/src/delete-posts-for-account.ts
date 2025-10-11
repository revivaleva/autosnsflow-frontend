import type { DeletionAdapters } from './types';

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

export async function deletePostsForAccountWithAdapters({ userId, accountId, limit }: { userId: string; accountId: string; limit?: number }, adapters: DeletionAdapters): Promise<{ deletedCount: number; remaining: boolean }> {
  if (!userId) throw new Error('userId required');
  if (!accountId) throw new Error('accountId required');

  if (typeof limit === 'undefined' || limit === null) {
    try {
      const v = adapters.getConfigValue ? adapters.getConfigValue('DELETION_BATCH_SIZE') : undefined;
      limit = Number(v || '100') || 100;
    } catch (_) {
      limit = 100;
    }
  }

  let threads: any[] = [];
  try {
    threads = await adapters.fetchThreadsPosts({ userId, accountId, limit: limit as number });
    try {
      let providerUserId: string | undefined = undefined;
      try {
        const acct = await adapters.getScheduledAccount({ userId, accountId });
        providerUserId = acct?.providerUserId;
      } catch (_) {}
      const replies = await adapters.fetchUserReplies({ userId, accountId, limit: limit as number, providerUserId });
      if (Array.isArray(replies) && replies.length > 0) {
        const existing = new Set((threads || []).map((x: any) => String(x.id)));
        for (const r of replies) {
          if (!existing.has(String(r.id))) threads.push(r);
        }
      }
    } catch (e) {
      try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'warn', message: 'fetchUserReplies failed', detail: { error: String(e) } }); } catch(_) {}
    }
    if (!Array.isArray(threads)) threads = [];
  } catch (e) {
    const msg = stringifyError(e);
    try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'fetch_failed', detail: { error: msg } }); } catch(_) {}
    throw new Error(`fetchThreadsPosts failed: ${msg}`);
  }

  let deletedCount = 0;
  let token: string | null = null;
  try {
    try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'attempt_get_token' }); } catch (_) {}
    token = await adapters.getTokenForAccount({ userId, accountId });
    if (!token) {
      try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'warn', message: 'missing_oauth_access_token' }); } catch(_) {}
      throw new Error('missing_oauth_access_token');
    }
    try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'got_token', detail: { tokenPreview: token ? `len=${String(token.length)}` : null } }); } catch (_) {}
  } catch (e) {
    const msg = stringifyError(e);
    try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'failed_read_account_token', detail: { error: msg } }); } catch(_) {}
    throw e;
  }

  for (const t of threads.slice(0, limit)) {
    const postId = String(t.id || t.postId || t.numericPostId || '');
    if (!postId) continue;
    try {
      try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'deleting_post', detail: { postId } }); } catch (_) {}
      await adapters.deleteThreadsPostWithToken({ postId, token });
      try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'deleted_post', detail: { postId } }); } catch (_) {}
    } catch (err) {
      const msg = stringifyError(err);
      if (isMissingPostError(msg)) {
        // treat missing post as deleted
      } else {
        try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'delete_failed', detail: { postId, error: msg } }); } catch(_) {}
        throw new Error(msg);
      }
    }

    try {
      const foundItems = await adapters.queryScheduled({ userId, accountId, postId });
      for (const it of foundItems || []) {
        const skToDel = it?.SK;
        if (!skToDel) continue;
        try {
          await adapters.deleteScheduledItem({ PK: it.PK, SK: skToDel });
        } catch (e) {
          try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'failed_to_delete_scheduled', detail: { sk: skToDel, error: String(e) } }); } catch(_) {}
          throw e;
        }
      }
    } catch (e) {
      const msg = stringifyError(e);
      try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'error', message: 'db_cleanup_failed', detail: { postId, error: msg } }); } catch(_) {}
      throw new Error(msg);
    }

    deletedCount++;
  }

  let remaining = false;
  try {
    const extra = await adapters.fetchThreadsPosts({ userId, accountId, limit: 1 });
    remaining = Array.isArray(extra) && extra.length > 0;
  } catch (e) {
    const msg = stringifyError(e);
    try { adapters.putLog && adapters.putLog({ userId, accountId, action: 'deletion', status: 'warn', message: 'remaining_check_failed', detail: { error: msg } }); } catch(_) {}
    remaining = true;
  }

  return { deletedCount, remaining };
}

export default deletePostsForAccountWithAdapters;


