import type { NextApiRequest, NextApiResponse } from "next";
// Use global fetch available in Node 18+ (build environment uses Node 20)
// Remove dependency on 'node-fetch' to avoid build-time module resolution errors.
import { createDynamoClient } from '@/lib/ddb';
import crypto from 'crypto';
import { GetItemCommand, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { getEnvVar } from '@/lib/env';

const ddb = createDynamoClient();
const TBL_THREADS = 'ThreadsAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code) return res.status(400).send('code missing');

  // Determine clientId/secret: if state contains accountId, try to read account-specific clientId/clientSecret from DB, else fall back to user default env
  const rawRedirectLocal = getEnvVar('THREADS_OAUTH_REDIRECT_LOCAL');
  const rawRedirectProd = getEnvVar('THREADS_OAUTH_REDIRECT_PROD');
  let redirectUri = rawRedirectLocal || (process.env.NODE_ENV === 'production' ? rawRedirectProd : undefined) || 'http://localhost:3000/api/auth/threads/callback';
  // defensive: ensure absolute URL
  if (typeof redirectUri !== 'string' || !/^https?:\/\//i.test(redirectUri.trim())) {
    console.warn('[oauth:callback] invalid redirectUri resolved, falling back to localhost', redirectUri);
    redirectUri = 'http://localhost:3000/api/auth/threads/callback';
  }

  // Prefer DB-stored clientId/clientSecret per-account; do not rely on env vars
  let clientId = '';
  let clientSecret = '';
  // parse state
  let accountIdFromState: string | null = null;
  try {
    if (state) {
      const decoded = Buffer.from(state, 'base64').toString('utf8');
      const obj = JSON.parse(decoded);
      accountIdFromState = obj?.a || null;
    }
  } catch (e) {
    // ignore
  }
  if (accountIdFromState) {
    try {
      // First try to read by cookie-associated user (fast path)
      const cookieUser = req.cookies['__session'];
      let found = false;
      if (cookieUser) {
        try {
          const get = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${cookieUser}` }, SK: { S: `ACCOUNT#${accountIdFromState}` } } }));
          const it = (get as any).Item || {};
          if (it.clientId && it.clientId.S) { clientId = it.clientId.S; found = true; }
          if (it.clientSecret && it.clientSecret.S) { clientSecret = it.clientSecret.S; }
        } catch (e) {
          console.log('[oauth] read account by cookie failed', e);
        }
      }

      // If not found via cookie/user, scan the table to find the account item by SK
      if (!found) {
        try {
          const scan = await ddb.send(new ScanCommand({
            TableName: TBL_THREADS,
            FilterExpression: 'SK = :sk',
            ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${accountIdFromState}` } },
            ProjectionExpression: 'clientId, clientSecret, PK, SK',
            Limit: 1,
          }));
          const items = (scan as any).Items || [];
          if (items.length > 0) {
            const it = items[0] || {};
            if (it.clientId && it.clientId.S) clientId = it.clientId.S;
            if (it.clientSecret && it.clientSecret.S) clientSecret = it.clientSecret.S;
          }
        } catch (e) {
          console.log('[oauth] scan for account failed', e);
        }
      }
    } catch (e) {
      console.log('[oauth] read account client failed', e);
    }
  }

  try {
    // code is validated above; coerce values to string to satisfy TypeScript
    const tokenUrl = `https://graph.facebook.com/v16.0/oauth/access_token?client_id=${encodeURIComponent(String(clientId))}&redirect_uri=${encodeURIComponent(String(redirectUri))}&client_secret=${encodeURIComponent(String(clientSecret))}&code=${encodeURIComponent(String(code))}`;
    const r = await fetch(tokenUrl, { method: 'GET' });
    const j = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'token exchange failed', detail: j });

    // j contains access_token and expires_in
    const accessToken = j.access_token;
    const expiresIn = Number(j.expires_in || 0);

    // Map to current user/account if possible
    const userId = req.cookies['__session'] || `local-${crypto.randomUUID()}`;
    const accountId = accountIdFromState || `threads_${crypto.randomUUID().slice(0,8)}`;

    // Save token to ThreadsAccounts table (merge with existing item)
    const item = {
      PK: { S: `USER#${userId}` },
      SK: { S: `ACCOUNT#${accountId}` },
      accessToken: { S: String(accessToken) },
      tokenExpiresAt: { N: String(Math.floor(Date.now()/1000) + expiresIn) },
      createdAt: { N: String(Math.floor(Date.now()/1000)) }
    };
    try { await ddb.send(new PutItemCommand({ TableName: TBL_THREADS, Item: item })); } catch (e) { console.log('[oauth] save token failed', e); }

    res.send('<html><body>Authentication successful. You may close this window.</body></html>');
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}


