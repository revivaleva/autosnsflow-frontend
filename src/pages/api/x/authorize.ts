import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';
import { getEnvVar } from '@/lib/env';

const ddb = createDynamoClient();
const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';

function base64url(buf: Buffer) {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;

    // generate PKCE verifier & challenge
    const codeVerifier = base64url(crypto.randomBytes(64));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

    // Use deterministic PKCE: require authenticated user and derive code_verifier from SESSION_SECRET and state
    let sessionSecret = getEnvVar('SESSION_SECRET') || process.env.SESSION_SECRET || '';
    if (!sessionSecret) {
      try {
        const cfg = await import('@/lib/config');
        const m = await cfg.loadConfig();
        sessionSecret = m['SESSION_SECRET'] || m['SESSIONSECRET'] || '';
        if (sessionSecret) console.log('[api/x/authorize] using SESSION_SECRET from AppConfig fallback');
      } catch (e) {
        console.warn('[api/x/authorize] AppConfig fallback for SESSION_SECRET failed', String(e));
      }
    }
    if (!sessionSecret) return res.status(500).json({ error: 'server_misconfigured' });

    // require authentication (Threads-style) so we can identify user and find per-account clientId
    let userIdForState: string | null = null;
    try {
      const user = await verifyUserFromRequest(req);
      userIdForState = user?.sub || null;
    } catch (e) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    // state includes nonce, accountId and userId
    const stateObj = { s: crypto.randomBytes(8).toString('hex'), a: accountId || null, u: userIdForState };
    const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');

    // deterministically derive code_verifier and code_challenge from sessionSecret + state
    const codeVerifierDerived = base64url(crypto.createHmac('sha256', sessionSecret).update(state).digest());
    const codeChallengeDerived = base64url(crypto.createHash('sha256').update(Buffer.from(codeVerifierDerived)).digest());

    // determine clientId: prefer DB per-account if provided; AppConfig fallback
    let clientId = '';
    if (accountId) {
      try {
        // Ensure requester is authenticated and use their userId as PK lookup
        const user = await verifyUserFromRequest(req);
        const userId = user.sub;
        const out = await ddb.send(new (require('@aws-sdk/client-dynamodb').GetItemCommand)({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: 'clientId' }));
        const it: any = (out as any).Item || {};
        if (it.clientId && it.clientId.S) clientId = it.clientId.S;
      } catch (e) {
        // ignore and allow fallback to AppConfig
        console.error('[api/x/authorize] failed to read clientId from account record:', String(e));
      }
    }

    // fallback: try AppConfig
    if (!clientId) {
      try {
        const cfg = await import('@/lib/config');
        const m = await cfg.loadConfig();
        clientId = m['X_CLIENT_ID'] || m['X_DEFAULT_CLIENT_ID'] || '';
      } catch (e) {}
    }

    if (!clientId) return res.status(400).json({ error: 'client_id not configured' });

    const redirectUri = process.env.X_REDIRECT_URI || `https://threadsbooster.jp/api/x/callback`;
    // Prefer AppConfig value for X_SCOPES; fall back to env var, then default
    let scopeRaw = '';
    try {
      const cfg = await import('@/lib/config');
      const m = await cfg.loadConfig();
      scopeRaw = m['X_SCOPES'] || m['X_DEFAULT_SCOPES'] || '';
      if (scopeRaw) console.log('[api/x/authorize] using X_SCOPES from AppConfig');
    } catch (e) {
      // ignore and fall back to env var
    }
    if (!scopeRaw) scopeRaw = process.env.X_SCOPES || '';
    // ensure tweet.read is present in scopes
    const scopeList = (scopeRaw || 'tweet.write users.read offline.access').trim().split(/\s+/).filter(Boolean);
    if (!scopeList.includes('tweet.read')) scopeList.push('tweet.read');
    const scope = encodeURIComponent(scopeList.join(' '));

    // build url with consistent parameter order: client_id, response_type, redirect_uri, state, code_challenge, code_challenge_method, scope
    const url = `https://x.com/i/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallengeDerived)}&code_challenge_method=S256&scope=${scope}`;

    if (req.query.raw === '1' || (req.headers.accept || '').includes('application/json')) {
      return res.status(200).json({ auth_url: url });
    }
    return res.redirect(url);
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
}


