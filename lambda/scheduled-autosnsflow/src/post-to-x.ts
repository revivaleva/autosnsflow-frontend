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
    // Build base params for Query. We'll page through results until we collect up to `limit`
    const baseParams: any = {
      TableName: TBL_X_SCHEDULED,
      IndexName: 'GSI_PendingByAccount',
      KeyConditionExpression: 'pendingForAutoPostAccount = :acc AND scheduledAt <= :now',
      // Filter to only pending and not deleted items (non-key filter)
      FilterExpression: '(attribute_not_exists(#st) OR #st = :pending) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':acc': { S: accountId }, ':now': { N: String(nowSec) }, ':pending': { S: 'pending' }, ':f': { BOOL: false } },
      Limit: limit,
    };

    // Page through Query results to account for FilterExpression removing items
    const collectedItems: any[] = [];
    let exclusiveStartKey: any = undefined;
    let page = 0;
    let lastResponse: any = null;
    do {
      const params: any = { ...baseParams };
      if (exclusiveStartKey) params.ExclusiveStartKey = exclusiveStartKey;
      lastResponse = await ddb.send(new QueryCommand(params));
      page++;
      const pageItems = (lastResponse as any).Items || [];
      if (pageItems.length) collectedItems.push(...pageItems);
      exclusiveStartKey = (lastResponse as any).LastEvaluatedKey;
      // continue until we have enough post-filtered items or no more pages
    } while (collectedItems.length < limit && exclusiveStartKey);

    // minimal logging: only counts to avoid verbose output in production
    try { console.info('[x-auto] fetchedPendingCandidates', { accountId, nowSec, returned: collectedItems.length }); } catch(_) {}
    return collectedItems || [];
  } catch (e) {
    throw e;
  }
}

// Alternate fetch: use GSI_ByAccount then filter client-side (closer to Threads approach)
export async function fetchDueXScheduledForAccountByAccount(accountId: string, nowSec: number, limit = 10) {
  try {
    const params: any = {
      TableName: TBL_X_SCHEDULED,
      IndexName: 'GSI_ByAccount',
      KeyConditionExpression: 'accountId = :acc AND scheduledAt <= :now',
      ExpressionAttributeValues: { ':acc': { S: accountId }, ':now': { N: String(nowSec) } },
      // retrieve a reasonable page to allow client-side filtering
      Limit: Math.max(100, limit * 5),
    };
    try { console.info('[x-auto] queryByAccountParams', { accountId, nowSec, params: { KeyConditionExpression: params.KeyConditionExpression, ExpressionAttributeValues: JSON.stringify(params.ExpressionAttributeValues), Limit: params.Limit } }); } catch (_) {}
    const q = await ddb.send(new QueryCommand(params));
    try { console.info('[x-auto] rawQueryByAccountResponse', { accountId, raw: JSON.stringify(q) }); } catch (_) {}
    const items: any[] = (q as any).Items || [];
    const filtered = items.filter((it: any) => {
      const st = it.status?.S || '';
      const isDeleted = it.isDeleted?.BOOL === true;
      // treat missing status as pending
      const isPending = (!st || st === 'pending');
      return isPending && !isDeleted && (Number(it.scheduledAt?.N || 0) <= Number(nowSec));
    }).slice(0, limit);
    try { console.info('[x-auto] fetchedByAccountFiltered', { accountId, nowSec, returned: filtered.length }); } catch(_) {}
    return filtered;
  } catch (e) {
    throw e;
  }
}

// Mark scheduled item as posted (update postedAt/status/postId)
export async function markXScheduledPosted(pk: string, sk: string, postId: string) {
  const now = Math.floor(Date.now() / 1000);
  // Update status and postedAt/postId; also remove pendingForAutoPostAccount so it no longer appears in GSI
  await ddb.send(new UpdateItemCommand({
    TableName: TBL_X_SCHEDULED,
    Key: { PK: { S: pk }, SK: { S: sk } },
    UpdateExpression: 'SET #st = :posted, postedAt = :ts, postId = :pid REMOVE pendingForAutoPostAccount',
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
  // Use account-based fetch (Threads-like) to reduce filter-induced empty-results
  const candidates = await fetchDueXScheduledForAccountByAccount(accountId, now, 1);
  try { console.info('[x-auto] nowSec', { userId, accountId, now }); } catch(_) {}
  let postedCount = 0;
  const debug: any = { candidates: (candidates || []).length, tokenPresent: !!(acct.oauthAccessToken || acct.accessToken), errors: [] };
  try { console.info('[x-auto] fetched candidates', { userId, accountId, candidateCount: debug.candidates }); } catch(_) {}
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
            // mark permanent failure on 403-like errors
            try {
              const errStr = String(postErr || '');
              if (/\\b403\\b|Forbidden|duplicate/i.test(errStr)) {
                try {
                  await ddb.send(new UpdateItemCommand({
                    TableName: TBL_X_SCHEDULED,
                    Key: { PK: { S: pk }, SK: { S: sk } },
                    UpdateExpression: 'SET permanentFailure = :t, lastPostError = :err',
                    ExpressionAttributeValues: { ':t': { BOOL: true }, ':err': { S: errStr } },
                  }));
                } catch (_) {}
              }
            } catch (_) {}
            throw postErr;
          }
        } catch (refreshErr) {
          // capture error and continue to next candidate
          try { console.warn('[x-auto] post failed and refresh failed', { userId, accountId, sk, err: String(postErr) }); } catch(_) {}
          debug.errors.push({ sk, err: String(postErr) });
          // also mark permanent failure when response indicates duplicate/403
          try {
            const errStr = String(postErr || '');
            if (/\\b403\\b|Forbidden|duplicate/i.test(errStr)) {
              try {
                await ddb.send(new UpdateItemCommand({
                  TableName: TBL_X_SCHEDULED,
                  Key: { PK: { S: pk }, SK: { S: sk } },
                  UpdateExpression: 'SET permanentFailure = :t, lastPostError = :err',
                  ExpressionAttributeValues: { ':t': { BOOL: true }, ':err': { S: errStr } },
                }));
              } catch (_) {}
            }
          } catch (_) {}
          continue;
        }
      }
      // debug: log post response body for observability (do not log tokens)
      try { console.info('[x-auto] post response', { userId, accountId, sk, response: r }); } catch(_) {}

      const postId = (r && r.data && (r.data.id || r.data?.id_str)) || '';
      if (!postId || String(postId).trim() === '') {
        try { console.warn('[x-auto] post returned no postId', { userId, accountId, sk, response: r }); } catch(_) {}
        debug.errors.push({ sk, err: 'no_post_id', response: r });
        continue;
      }

      try {
        await markXScheduledPosted(pk, sk, String(postId));
      } catch (e) {
        try { console.warn('[x-auto] markXScheduledPosted failed', { userId, accountId, sk, err: String(e) }); } catch(_) {}
        debug.errors.push({ sk, err: String(e) });
        continue;
      }
      postedCount++;
      // notify user-level discord webhooks only if user has enableX=true in settings
      try {
        const settingsOut = await ddb.send(new GetItemCommand({ TableName: process.env.TBL_SETTINGS || 'UserSettings', Key: { PK: { S: `USER#${userId}` }, SK: { S: 'SETTINGS' } }, ProjectionExpression: 'enableX' }));
        const enableX = Boolean(settingsOut?.Item?.enableX?.BOOL === true);
        const userContent = `【X 投稿】アカウント ${accountId} にて予約投稿が実行されました\npostId: ${postId}\ncontent: ${String(content).slice(0,200)}`;
        if (enableX) {
          try { await postDiscordLog({ userId, content: userContent }); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        // log but don't fail posting
        try { console.warn('[warn] check enableX or postDiscordLog failed', String(e)); } catch(_) {}
      }
      // notify master webhook (always)
      try { await postDiscordMaster(`**[X POSTED]** user=${userId} account=${accountId} postId=${postId}\n${String(content).slice(0,200)}`); } catch(e) {}
    } catch (e) {
      try { console.warn('[x-auto] runAutoPostForXAccount item failed', { userId, accountId, err: String(e) }); } catch(_) {}
      debug.errors.push({ err: String(e) });
      // mark permanent failure on 403/duplicate
      try {
        const errStr = String(e || '');
        if (/\\b403\\b|Forbidden|duplicate/i.test(errStr)) {
          try {
            await ddb.send(new UpdateItemCommand({
              TableName: TBL_X_SCHEDULED,
              Key: { PK: { S: pk }, SK: { S: sk } },
              UpdateExpression: 'SET permanentFailure = :t, lastPostError = :err',
              ExpressionAttributeValues: { ':t': { BOOL: true }, ':err': { S: errStr } },
            }));
          } catch (_) {}
        }
      } catch (_) {}
      // continue with next candidate
      continue;
    }
  }
  // If there are collected errors, log them verbosely for debugging
  try {
    if (debug && Array.isArray(debug.errors) && debug.errors.length > 0) {
      try { console.info('[x-auto] runAutoPostForXAccount debug.errors', { userId, accountId, errors: debug.errors }); } catch(_) {}
    }
  } catch (_) {}
  return { posted: postedCount, debug };
}

// Consume one PostPool item for this user/account and post it to X.
export async function postFromPoolForAccount(userId: string, acct: any, opts: { dryRun?: boolean, lockTtlSec?: number } = {}) {
  const TBL_POOL = process.env.TBL_POST_POOL || 'PostPool';
  const now = Math.floor(Date.now() / 1000);
  const lockTtl = Number(opts.lockTtlSec || 600);
  const accountId = acct.accountId;
  const poolType = acct.type || 'general';
  const debug: any = { tried: 0, posted: 0, errors: [] };

  // 1) Query pool items for this user and poolType
  try {
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_POOL,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'POOL#' } },
      Limit: 50,
    }));
    const items: any[] = (q as any).Items || [];
    // filter by poolType
    const candidates = items.map(it => ({
      pk: it.PK,
      sk: it.SK,
      poolId: it.poolId?.S || (it.SK?.S || '').replace(/^POOL#/, ''),
      type: it.type?.S || 'general',
      content: it.content?.S || '',
      createdAt: it.createdAt?.N ? Number(it.createdAt.N) : 0,
    })).filter(x => (x.type || 'general') === poolType);

    if (!candidates.length) {
      return { posted: 0, debug: { reason: 'no_pool_items' } };
    }

    // choose oldest (FIFO)
    candidates.sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0));
    const cand = candidates[0];
    debug.tried = 1;

    // If dryRun requested, do not acquire locks or modify DB — just report the candidate.
    if (opts.dryRun || (global as any).__TEST_CAPTURE__) {
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'DRYRUN_POST_FROM_POOL', payload: { userId, accountId, poolId: cand.poolId } }); } catch(_) {}
      return { posted: 0, debug: { dryRun: true, poolId: cand.poolId } };
    }

    // 2) Atomically claim (delete) a pool item for this candidate list.
    let claimedFromPool: any = null;
    for (const candidate of candidates) {
      try {
        const delRes: any = await ddb.send(new DeleteItemCommand({
          TableName: TBL_POOL,
          Key: { PK: { S: String(candidate.pk.S) }, SK: { S: String(candidate.sk.S) } },
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
          ReturnValues: 'ALL_OLD',
        }));
        const attrs = delRes && delRes.Attributes ? delRes.Attributes : null;
        if (attrs) {
          claimedFromPool = {
            poolId: candidate.poolId,
            content: getS(attrs.content) || candidate.content || "",
            images: attrs.images ? (getS(attrs.images) ? JSON.parse(getS(attrs.images)) : []) : (candidate.images || []),
          };
          // set cand to the claimed one for downstream logging/usage
          Object.assign(cand, candidate);
          break;
        }
      } catch (e:any) {
        // failed to claim this candidate (race) - try next
        continue;
      }
    }
    if (!claimedFromPool) {
      // nobody claimable
      debug.errors.push({ err: 'no_claimable_pool_item' });
      return { posted: 0, debug };
    }

    // Note: Do not create new XScheduledPosts records here. 5min flow should update existing scheduled posts only.

    // 4) perform post using acct tokens (try refresh on failure)
    try {
      let accessToken = acct.oauthAccessToken || acct.accessToken || '';
      let resp;
      try {
        resp = await postToX({ accessToken, text: cand.content || '' });
      } catch (postErr:any) {
        // try refresh
        const newToken = await refreshXAccountToken(userId, accountId);
        if (newToken) {
          accessToken = newToken;
          resp = await postToX({ accessToken, text: cand.content || '' });
        } else {
          throw postErr;
        }
      }
      const postId = (resp && resp.data && (resp.data.id || resp.data.id_str)) || '';
      if (!postId) throw new Error('no_post_id');

      // 5) delete pool item
      // pool already consumed by atomic DeleteItem above; nothing to do here
 
      // 5min flow updates the existing scheduled record (TBL_SCHEDULED) elsewhere; do not create/update separate XScheduledPosts here.

      // 6) write ExecutionLogs / Discord notification (reuse postDiscordMaster if available globally)
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'POST_FROM_POOL_RESULT', payload: { userId, accountId, poolId: cand.poolId, postId } }); } catch(_) {}
      try { await postDiscordMaster(`**[X POST FROM POOL]** user=${userId} account=${accountId} poolId=${cand.poolId} postId=${postId}\n${String(cand.content || '').slice(0,200)}`); } catch(_) {}

      debug.posted = 1;
      return { posted: 1, debug, postId };
    } catch (e:any) {
      debug.errors.push({ err: String(e) });
      // Do not create/update XScheduledPosts here on failure; 5min reservation updates are handled by the calling flow.
      // release lock
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_POOL,
          Key: { PK: { S: String(cand.pk.S) }, SK: { S: String(cand.sk.S) } },
          UpdateExpression: 'REMOVE postingLockOwner, postingLockExpiresAt',
        }));
      } catch (_) {}
      return { posted: 0, debug };
    }
  } catch (e:any) {
    return { posted: 0, debug: { err: String(e) } };
  }
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


