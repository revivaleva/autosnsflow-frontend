import { createDynamoClient } from '@/lib/ddb';
import { PutItemCommand, QueryCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL_X_SCHEDULED = process.env.TBL_X_SCHEDULED || 'XScheduledPosts';

export async function postToX({ accessToken, text }: { accessToken: string; text: string }) {
  const url = 'https://api.x.com/2/tweets';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`X post failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Fetch due X scheduled posts for an account (uses GSI_PendingByAccount)
export async function fetchDueXScheduledForAccount(accountId: string, nowSec: number, limit = 10) {
  try {
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_X_SCHEDULED,
      IndexName: 'GSI_PendingByAccount',
      KeyConditionExpression: 'pendingForAutoPostAccount = :acc AND scheduledAt <= :now',
      ExpressionAttributeValues: { ':acc': { S: accountId }, ':now': { N: String(nowSec) } },
      Limit: limit,
    }));
    return (q as any).Items || [];
  } catch (e) {
    throw e;
  }
}

// Mark scheduled item as posted (update postedAt/status/postId)
export async function markXScheduledPosted(pk: string, sk: string, postId: string) {
  const now = Math.floor(Date.now() / 1000);
  await ddb.send(new UpdateItemCommand({
    TableName: TBL_X_SCHEDULED,
    Key: { PK: { S: pk }, SK: { S: sk } },
    UpdateExpression: 'SET #st = :posted, postedAt = :ts, postId = :pid',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':posted': { S: 'posted' }, ':ts': { N: String(now) }, ':pid': { S: postId } },
  }));
}

// Skeleton runner to be invoked by the 5-min job per account
export async function runAutoPostForXAccount(acct: any, userId: string) {
  // acct must include oauthAccessToken (use refresh logic elsewhere)
  if (!acct || !acct.autoPostEnabled) return { posted: 0 };
  const now = Math.floor(Date.now() / 1000);
  const accountId = acct.accountId;

  const candidates = await fetchDueXScheduledForAccount(accountId, now, 1);
  let postedCount = 0;
  for (const it of candidates) {
    try {
      const pk = it.PK.S; const sk = it.SK.S;
      const content = it.content.S || '';
      // Prevent double-posting: ensure status is pending
      if ((it.status && it.status.S) && it.status.S !== 'pending') continue;
      // Try posting, attempt refresh once on failure
      let accessToken = acct.oauthAccessToken || acct.accessToken || '';
      let r;
      try {
        r = await postToX({ accessToken, text: content });
      } catch (postErr) {
        // Try token refresh using stored refreshToken
        try {
          const newToken = await refreshXAccountToken(userId, accountId);
          if (newToken) {
            accessToken = newToken;
            r = await postToX({ accessToken, text: content });
          } else {
            throw postErr;
          }
        } catch (refreshErr) {
          throw postErr;
        }
      }
      const postId = (r && r.data && (r.data.id || r.data?.id_str)) || '';
      await markXScheduledPosted(pk, sk, String(postId));
      postedCount++;
      // notify user-level discord webhooks
      try {
        const content = `【X 投稿】アカウント ${accountId} にて予約投稿が実行されました\npostId: ${postId}\ncontent: ${String(content).slice(0,200)}`;
        try { await postDiscordLog({ userId, content }); } catch(e) {}
      } catch(e) {}
      // notify master webhook
      try { await postDiscordMaster(`**[X POSTED]** user=${userId} account=${accountId} postId=${postId}\n${String(content).slice(0,200)}`); } catch(e) {}
    } catch (e) {
      // TODO: implement retries, logging, update status to 'failed'
    }
  }
  return { posted: postedCount };
}

// Refresh a single X account token using stored refresh_token and client credentials
async function refreshXAccountToken(userId: string, accountId: string) {
  const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';
  try {
    const out = await ddb.send(new GetItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
    const it: any = (out as any).Item || {};
    const clientId = it.clientId?.S || it.client_id?.S || '';
    const clientSecret = it.clientSecret?.S || it.client_secret?.S || '';
    const refreshToken = it.refreshToken?.S || it.oauthRefreshToken?.S || '';
    if (!refreshToken) return null;
    const tokenUrl = 'https://api.x.com/2/oauth2/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    if (clientId && !clientSecret) params.append('client_id', clientId);
    const headers: any = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (clientId && clientSecret) headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const resp = await fetch(tokenUrl, { method: 'POST', headers, body: params });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.access_token) return null;
    const at = String(j.access_token || '');
    const rt = String(j.refresh_token || refreshToken);
    const expiresIn = Number(j.expires_in || 0);
    const expiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : 0;
    try {
      await ddb.send(new UpdateItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET oauthAccessToken = :at, refreshToken = :rt, oauthTokenExpiresAt = :exp, oauthSavedAt = :now', ExpressionAttributeValues: { ':at': { S: at }, ':rt': { S: rt }, ':exp': { N: String(expiresAt || 0) }, ':now': { N: String(Math.floor(Date.now() / 1000)) } } }));
    } catch (_) {}
    return at;
  } catch (e) {
    return null;
  }
}


