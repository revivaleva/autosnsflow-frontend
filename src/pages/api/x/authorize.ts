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
    const sessionSecret = getEnvVar('SESSION_SECRET') || process.env.SESSION_SECRET || '';
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
    const scope = encodeURIComponent((process.env.X_SCOPES || 'tweet.write users.read offline.access').trim());

    const url = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallengeDerived)}&code_challenge_method=S256`;

    if (req.query.raw === '1' || (req.headers.accept || '').includes('application/json')) {
      return res.status(200).json({ auth_url: url });
    }
    return res.redirect(url);
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
}


