import type { NextApiRequest, NextApiResponse } from "next";
import { createDynamoClient } from '@/lib/ddb';
import crypto from 'crypto';

const ddb = createDynamoClient();
const TBL_THREADS = 'ThreadsAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code) return res.status(400).send('code missing');

  // Determine clientId/secret: if state contains accountId, try to read account-specific clientId/clientSecret from DB, else fall back to user default env
  const redirectUri = process.env.THREADS_OAUTH_REDIRECT_LOCAL || (process.env.NODE_ENV === 'production' ? process.env.THREADS_OAUTH_REDIRECT_PROD : 'http://localhost:3000/api/auth/threads/callback');
  let clientId = process.env.THREADS_CLIENT_ID || process.env.THREADS_APP_ID || '';
  let clientSecret = process.env.THREADS_CLIENT_SECRET || '';
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
      const get = await ddb.send(new (require('@aws-sdk/client-dynamodb').GetItemCommand)({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${req.cookies['__session'] || 'local'}` }, SK: { S: `ACCOUNT#${accountIdFromState}` } } }));
      const it = get.Item || {};
      if (it.clientId && it.clientId.S) clientId = it.clientId.S;
      if (it.clientSecret && it.clientSecret.S) clientSecret = it.clientSecret.S;
    } catch (e) {
      console.log('[oauth] read account client failed', e);
    }
  }

  try {
    const tokenUrl = `https://graph.facebook.com/v16.0/oauth/access_token?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}`;
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
    try { await ddb.send(new (require("@aws-sdk/client-dynamodb").PutItemCommand)({ TableName: TBL_THREADS, Item: item })); } catch (e) { console.log('[oauth] save token failed', e); }

    res.send('<html><body>Authentication successful. You may close this window.</body></html>');
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}


