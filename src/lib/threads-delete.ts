import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

// Fetch token for given user/account from ThreadsAccounts table
// NOTE: accessToken is deprecated and intentionally not referenced here.
export async function getTokenForAccount({ userId, accountId }: { userId: string; accountId: string }) {
  if (!userId) throw new Error('userId required');
  if (!accountId) throw new Error('accountId required');
  const get = await ddb.send(new GetItemCommand({ TableName: TBL, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: 'oauthAccessToken, oauthAccessTokenExpiresAt' }));
  const oauthAccessToken = (get.Item?.oauthAccessToken?.S || '').trim();
  // Optionally, caller can examine oauthAccessTokenExpiresAt to decide refresh
  return oauthAccessToken || null;
}

// Delete a threads post using an externally-provided token. Caller may obtain token once and reuse.
export async function deleteThreadsPostWithToken({ postId, token }: { postId: string; token: string }) {
  if (!postId) throw new Error('postId required');
  if (!token) throw new Error('token required');
  const base = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';
  // Do not log tokens. Build safe URL for logging without the access_token query param.
  const url = `${base}/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(token)}`;
  const urlForLog = `${base}/${encodeURIComponent(postId)}`;
  const resp = await fetch(url, { method: 'DELETE' } as any);
  const text = await resp.text().catch(() => '');
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  // debug logging removed
  if (!resp.ok) {
    // include parsed body for richer error messages
    const errMsg = `threads_delete_failed: ${resp.status} ${JSON.stringify(json)}`;
    console.warn('[threads-delete] delete failed', { postId, status: resp.status, errorBody: String(text).slice(0, 1000) });
    throw new Error(errMsg);
  }
  return { ok: true, status: resp.status, body: json };
}

// Backwards-compatible helper that fetches token internally and deletes.
export async function deleteThreadsPost({ postId, accountId, userId }: { postId: string; accountId: string; userId: string }) {
  const token = await getTokenForAccount({ userId, accountId });
  if (!token) throw new Error('missing_access_token');
  return await deleteThreadsPostWithToken({ postId, token });
}


