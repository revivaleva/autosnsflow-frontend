import type { NextApiRequest, NextApiResponse } from "next";
// Use global fetch available in Node 18+ (build environment uses Node 20)
// Remove dependency on 'node-fetch' to avoid build-time module resolution errors.
import { createDynamoClient } from '@/lib/ddb';
import crypto from 'crypto';
import { GetItemCommand, PutItemCommand, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
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
  // defensive: ensure redirectUri is an absolute http(s) URL; trim env values
  try {
    redirectUri = String(redirectUri).trim();
    if (typeof redirectUri !== 'string' || !/^https?:\/\//i.test(redirectUri)) {
      console.warn('[oauth:callback] invalid redirectUri resolved, falling back to localhost', redirectUri);
      redirectUri = 'http://localhost:3000/api/auth/threads/callback';
    }
  } catch (e) {
    redirectUri = 'http://localhost:3000/api/auth/threads/callback';
  }

  // Prefer DB-stored clientId/clientSecret per-account; env fallback allowed
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

      // If not found via cookie/user, try Query by SK using a GSI (avoid Scan). Fall back to Scan if Query/GSI unavailable.
      if (!found) {
        try {
          const q = await ddb.send(new QueryCommand({
            TableName: TBL_THREADS,
            IndexName: 'GSI1', // GSI1 should have SK as partition key
            KeyConditionExpression: 'SK = :sk',
            ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${accountIdFromState}` } },
            ProjectionExpression: 'clientId, clientSecret, PK, SK',
            Limit: 1,
          }));
          const it: any = (q as any).Items?.[0] || {};
          if (it.clientId && it.clientId.S) clientId = it.clientId.S;
          if (it.clientSecret && it.clientSecret.S) clientSecret = it.clientSecret.S;
        } catch (e) {
          console.log('[oauth] query by SK via GSI1 failed, falling back to Scan', e);
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
              const it2 = items[0] || {};
              if (it2.clientId && it2.clientId.S) clientId = it2.clientId.S;
              if (it2.clientSecret && it2.clientSecret.S) clientSecret = it2.clientSecret.S;
            }
          } catch (e2) {
            console.log('[oauth] scan for account failed', e2);
          }
        }
      }
    } catch (e) {
      console.log('[oauth] read account client failed', e);
    }
  }

    let j: any;
    try {
      // env fallback if DB missing
      const envClientId     = process.env.THREADS_CLIENT_ID     || getEnvVar?.('THREADS_CLIENT_ID');
      const envClientSecret = process.env.THREADS_CLIENT_SECRET || getEnvVar?.('THREADS_CLIENT_SECRET');
      if (!clientId && envClientId) clientId = String(envClientId).trim();
      if (!clientSecret && envClientSecret) clientSecret = String(envClientSecret).trim();

      // final guard
      if (!clientId || !clientSecret) {
        console.warn('[threads:token] missing clientId or clientSecret', { accountIdFromState });
        return res.status(400).json({ error: 'client_id or client_secret not configured' });
      }

      const ru = String(redirectUri).trim(); // use raw absolute URL (must match authorize)
      const tokenUrl = 'https://graph.threads.net/oauth/access_token';
      const body = new URLSearchParams({
        client_id: String(clientId),
        client_secret: String(clientSecret), // do not log this
        redirect_uri: ru,                    // raw URL (authorize must match exactly)
        code: String(code),
      });

      console.log('[threads:token] POST', tokenUrl);
      console.log('[threads:token] body', body.toString().replace(String(clientSecret || ''), '***'));

      const r = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      j = await r.json();
      if (!r.ok) return res.status(500).json({ error: 'token exchange failed', detail: j });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: String(e) });
    }

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

    // send master Discord notification with masked details
    try {
      const masterUrl = process.env.MASTER_DISCORD_WEBHOOK || process.env.DISCORD_MASTER_WEBHOOK || '';
      if (masterUrl) {
        const maskedCode = code ? `${String(code).slice(0, 6)}***` : null;
        const maskedAccess = accessToken ? `${String(accessToken).slice(0, 6)}***` : null;
        const payload = {
          timestamp: new Date().toISOString(),
          accountIdFromState: accountIdFromState || null,
          incoming: { code: maskedCode, state: state || null, redirect_uri: String(redirectUri).trim(), client_id: clientId ? 'configured' : null },
          token_response: { access_token: maskedAccess, expires_in: expiresIn || 0 },
          saved_to_db: !!accessToken
        };
        const bodyStr = JSON.stringify(payload, null, 2).slice(0, 1800);
        const content = `**[MASTER] Threads OAuth callback**\n\n\`\`\`json\n${bodyStr}\n\`\`\``;
        try {
          const resp = await fetch(masterUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.log('[threads:notify] master discord post failed', resp.status, text);
          } else {
            console.log('[threads:notify] master discord sent');
          }
        } catch (e) {
          console.log('[threads:notify] failed to send master discord', e);
        }
      }
    } catch (e) {
      console.log('[threads:notify] failed to prepare master discord payload', e);
    }

    res.send('<html><body>Authentication successful. You may close this window.</body></html>');
}


