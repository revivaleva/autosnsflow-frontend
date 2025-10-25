import type { NextApiRequest, NextApiResponse } from 'next';
import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { verifyUserFromRequest } from '@/lib/auth';

const ddb = createDynamoClient();
const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    // debug logging removed
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { accountId, text } = body || {};
    if (!accountId || !text) return res.status(400).json({ error: 'accountId and text required' });

    // Read account token from XAccounts table
    const out = await ddb.send(new GetItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
    const it: any = (out as any).Item || {};
    // Prefer oauthAccessToken, fall back to legacy accessToken
    let tokenFromDb = String(it.oauthAccessToken?.S || it.accessToken?.S || '');
    // Read refresh token and expiry (handle either naming)
    const refreshTokenFromDb = String(it.refreshToken?.S || it.oauthRefreshToken?.S || '');
    const expiresAtRaw = it.oauthTokenExpiresAt?.N || it.oauthTokenExpiresAt?.S || null;
    const oauthTokenExpiresAt = expiresAtRaw ? Number(expiresAtRaw) : 0;
    let token = tokenFromDb;
    let usingFallback = false;
    if (!token) {
      try {
        const cfg = await import('@/lib/config');
        const m = await cfg.loadConfig();
        const fallbackToken = m['X_APP_DEFAULT_TOKEN'] || '';
        if (fallbackToken) { token = fallbackToken; usingFallback = true; }
      } catch (e) { console.warn('[api/x/tweet] loadConfig failed', String(e)); }
    }
    // debug logging removed
    // If token is about to expire within threshold, attempt refresh synchronously
    let refreshThreshold = Number(process.env.TOKEN_REFRESH_THRESHOLD_SEC || process.env.TOKEN_REFRESH_THRESHOLD || '60');
    try {
      const cfg = await import('@/lib/config');
      const m = await cfg.loadConfig();
      const cfgVal = m['TOKEN_REFRESH_THRESHOLD_SEC'] || m['TOKEN_REFRESH_THRESHOLD'];
      if (cfgVal) refreshThreshold = Number(cfgVal);
      if (cfgVal) try { console.log('[api/x/tweet] using TOKEN_REFRESH_THRESHOLD_SEC from AppConfig', refreshThreshold); } catch(_) {}
    } catch (e) {
      // ignore and use env/default
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (!token && !refreshTokenFromDb) return res.status(403).json({ error: 'no_token' });
    if (oauthTokenExpiresAt && oauthTokenExpiresAt - nowSec <= refreshThreshold && refreshTokenFromDb) {
      try {
        // Resolve clientId/secret from DB or AppConfig
        const clientId = String(it.clientId?.S || it.client_id?.S || '');
        const clientSecret = String(it.clientSecret?.S || it.client_secret?.S || '');
        let tokenUrl = 'https://api.x.com/2/oauth2/token';
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshTokenFromDb);
        if (clientId && !clientSecret) {
          // include client_id if no secret is provided
          params.append('client_id', clientId);
        }
        const headers: Record<string,string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (clientId && clientSecret) {
          headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
        }
        const refreshResp = await fetch(tokenUrl, { method: 'POST', headers, body: params });
        const refreshJson = await refreshResp.json().catch(() => ({}));
        if (refreshResp.ok && refreshJson.access_token) {
          token = String(refreshJson.access_token || '');
          const newRefreshToken = String(refreshJson.refresh_token || refreshTokenFromDb);
          const expiresIn = Number(refreshJson.expires_in || 0);
          const newExpiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : 0;
          // persist new tokens
          try {
            await ddb.send(new UpdateItemCommand({
              TableName: TBL_X,
              Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
              UpdateExpression: 'SET oauthAccessToken = :at, refreshToken = :rt, oauthTokenExpiresAt = :exp, oauthSavedAt = :now',
              ExpressionAttributeValues: {
                ':at': { S: String(token) },
                ':rt': { S: String(newRefreshToken) },
                ':exp': { N: String(newExpiresAt || 0) },
                ':now': { N: String(Math.floor(Date.now() / 1000)) }
              }
            }));
          } catch (dbErr) {
            console.warn('[api/x/tweet] failed to persist refreshed token', String(dbErr));
          }
        }
      } catch (e) {
        console.warn('[api/x/tweet] token refresh failed', String(e));
        // fall through and attempt to use existing token (may be invalid)
      }
    }

    // forward to X API
    const r = await fetch('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(500).json({ error: 'post_failed', detail: j });
    }
    return res.status(200).json(j);
    return res.status(200).json(j);
  } catch (e: any) { return res.status(500).json({ error: String(e) }); }
}


