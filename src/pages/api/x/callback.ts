import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand, QueryCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { getEnvVar } from '@/lib/env';

function base64url(buf: Buffer) {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const ddb = createDynamoClient();
const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code) return res.status(400).send('code missing');

  // parse state
  let accountIdFromState: string | null = null;
  try { if (state) { const decoded = Buffer.from(state, 'base64').toString('utf8'); const obj = JSON.parse(decoded); accountIdFromState = obj?.a || null; } } catch (e) {}

  // resolve clientId/clientSecret from DB by accountId
  let clientId = ''; let clientSecret = '';
  if (accountIdFromState) {
    try {
      // Try GSI lookup first (fast) - GSI name may vary across deployments
      try {
        const q = await ddb.send(new QueryCommand({ TableName: TBL_X, IndexName: 'GSI1', KeyConditionExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${accountIdFromState}` } }, ProjectionExpression: 'clientId, clientSecret, PK', Limit: 1 }));
        const it: any = (q as any).Items?.[0] || {};
        if (it.clientId && it.clientId.S) clientId = it.clientId.S;
        if (it.clientSecret && it.clientSecret.S) clientSecret = it.clientSecret.S;
      } catch (e) {
        console.warn('[x:callback] GSI1 query failed or index not present, falling back to scan');
      }

      // Fallback: scan the table for an item with matching SK (works without GSI)
      if (!clientId || !clientSecret) {
        try {
          const scan = await ddb.send(new ScanCommand({ TableName: TBL_X, FilterExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${accountIdFromState}` } }, ProjectionExpression: 'clientId, clientSecret, PK', Limit: 1 }));
          const it2: any = (scan as any).Items?.[0] || {};
          if (it2.clientId && it2.clientId.S) clientId = it2.clientId.S;
          if (it2.clientSecret && it2.clientSecret.S) clientSecret = it2.clientSecret.S;
        } catch (e) {
          console.warn('[x:callback] scan fallback failed', e);
        }
        // Additional fallback: scan by accountId attribute in case SK/indices differ
        if (!clientId || !clientSecret) {
          try {
            const scan2 = await ddb.send(new ScanCommand({ TableName: TBL_X, FilterExpression: 'accountId = :aid', ExpressionAttributeValues: { ':aid': { S: `${accountIdFromState}` } }, ProjectionExpression: 'clientId, clientSecret, PK', Limit: 1 }));
            const it3: any = (scan2 as any).Items?.[0] || {};
            if (it3.clientId && it3.clientId.S) clientId = it3.clientId.S;
            if (it3.clientSecret && it3.clientSecret.S) clientSecret = it3.clientSecret.S;
            if (it3 && it3.PK && it3.PK.S) console.log('[x:callback] fallback found item PK:', it3.PK.S);
          } catch (ee) {
            console.warn('[x:callback] scan by accountId fallback failed', ee);
          }
        }
      }
    } catch (e) { console.warn('[x:callback] resolve client failed', e); }
  }
  // debug: log what we resolved (mask secrets)
  try {
    console.log('[x:callback] state:', state, 'accountIdFromState:', accountIdFromState);
    console.log('[x:callback] resolved clientId present:', !!clientId, 'clientSecret present:', !!clientSecret);
  } catch (e) {}

  if (!clientId || !clientSecret) {
    // try AppConfig fallback for clientId/secret
    try {
      const cfg = await import('@/lib/config');
      const m = await cfg.loadConfig();
      clientId = clientId || m['X_CLIENT_ID'] || '';
      clientSecret = clientSecret || m['X_CLIENT_SECRET'] || '';
    } catch (e) {}
  }
  // Determine code_verifier deterministically from SESSION_SECRET + state (no cookie or DB state required)
  let sessionSecret = getEnvVar('SESSION_SECRET') || process.env.SESSION_SECRET || '';
  if (!sessionSecret) {
    try {
      const cfg = await import('@/lib/config');
      const m = await cfg.loadConfig();
      sessionSecret = m['SESSION_SECRET'] || m['SESSIONSECRET'] || '';
      if (sessionSecret) console.log('[api/x/callback] using SESSION_SECRET from AppConfig fallback');
    } catch (e) {
      console.warn('[api/x/callback] AppConfig fallback for SESSION_SECRET failed', String(e));
    }
  }
  if (!sessionSecret) return res.status(500).json({ error: 'server_misconfigured' });
  let codeVerifierFromStore = '';
  try {
    if (state) {
      // decode state to get user/account info if needed
      const decoded = Buffer.from(state, 'base64').toString('utf8');
      let parsed: any = {};
      try { parsed = JSON.parse(decoded); } catch (e) {}
      const storedAccountId = parsed?.a || null;
      const storedUserId = parsed?.u || null;
      // derive code_verifier the same way as authorize
      codeVerifierFromStore = base64url(crypto.createHmac('sha256', sessionSecret).update(state).digest());
      // if clientId/clientSecret not resolved yet and we have storedUserId/accountId, try direct GetItem
      if ((!clientId || !clientSecret) && storedUserId && storedAccountId) {
        try {
          const out2 = await ddb.send(new (require('@aws-sdk/client-dynamodb').GetItemCommand)({ TableName: TBL_X, Key: { PK: { S: `USER#${storedUserId}` }, SK: { S: `ACCOUNT#${storedAccountId}` } }, ProjectionExpression: 'clientId, clientSecret' }));
          const it2: any = (out2 as any).Item || {};
          if (it2.clientId && it2.clientId.S) clientId = it2.clientId.S;
          if (it2.clientSecret && it2.clientSecret.S) clientSecret = it2.clientSecret.S;
          if (clientId || clientSecret) console.log('[x:callback] resolved client via stored state for user:', storedUserId);
        } catch (e) { console.warn('[x:callback] get by stored user/account failed', e); }
      }
    }
  } catch (e) { console.warn('[x:callback] state-derive fallback failed', e); }
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'client_id or client_secret not configured' });

  const redirectUri = process.env.X_REDIRECT_URI || `https://threadsbooster.jp/api/x/callback`;
  const tokenUrl = 'https://api.x.com/2/oauth2/token';
  // X expects client credentials via Authorization header (Basic) for the token endpoint.
  const codeVerifier = (req.cookies['x_pkce'] && String(req.cookies['x_pkce'])) || codeVerifierFromStore || '';
  const params = new URLSearchParams({ grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri, code_verifier: codeVerifier });

  let tokenResp: any;
  try {
    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: authHeader }, body: params });
    tokenResp = await r.json().catch(() => ({}));
    // Log full token response for diagnostics (do NOT log clientSecret)
    try { console.log('[x:callback] token exchange response:', JSON.stringify(tokenResp)); } catch(_) {}
    if (!r.ok) {
      console.error('[x:callback] token exchange failed', { status: r.status, body: tokenResp });
      return res.status(500).json({ error: 'token exchange failed', detail: tokenResp });
    }
  } catch (e) { console.error('[x:callback] token request error', e); return res.status(500).json({ error: String(e) }); }

  const accessToken = tokenResp.access_token;

  // fetch user info
  try {
    const me = await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!me.ok) { console.warn('[x:callback] users/me failed'); }
    const meJson = await me.json().catch(() => ({}));
    const providerUserId = meJson?.data?.id || '';

    // Save tokens into account record
    if (accountIdFromState) {
      // find PK for item
      let targetUserId: string | null = null;
      try {
        const q2 = await ddb.send(new QueryCommand({ TableName: TBL_X, IndexName: 'GSI1', KeyConditionExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${accountIdFromState}` } }, ProjectionExpression: 'PK', Limit: 1 }));
        const it2: any = (q2 as any).Items?.[0] || {};
      if (it2 && it2.PK && it2.PK.S) { const pk = String(it2.PK.S || ''); targetUserId = pk.startsWith('USER#') ? pk.replace(/^USER#/, '') : pk; }
      } catch (e) {}
      if (targetUserId) {
        await ddb.send(new UpdateItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${targetUserId}` }, SK: { S: `ACCOUNT#${accountIdFromState}` } }, UpdateExpression: 'SET oauthAccessToken = :at, oauthSavedAt = :now, providerUserId = :pid', ExpressionAttributeValues: { ':at': { S: String(accessToken) }, ':now': { N: String(Math.floor(Date.now()/1000)) }, ':pid': { S: String(providerUserId) } } }));
        // cleanup stored state
        try { await ddb.send(new (require('@aws-sdk/client-dynamodb').DeleteItemCommand)({ TableName: TBL_X, Key: { PK: { S: `STATE#${state}` }, SK: { S: 'META' } } })); } catch (e) {}
      }
    }
  } catch (e) { console.warn('[x:callback] save token failed', e); }

  res.send('<html><body>Authentication successful. You may close this window.</body></html>');
}


