import type { NextApiRequest, NextApiResponse } from 'next';
import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { verifyUserFromRequest } from '@/lib/auth';

const ddb = createDynamoClient();
const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    try { console.log('[api/x/tweet] POST payload:', req.body); } catch(_) {}
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { accountId, text } = body || {};
    if (!accountId || !text) return res.status(400).json({ error: 'accountId and text required' });

    // Read account token from XAccounts table
    const out = await ddb.send(new GetItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
    const it: any = (out as any).Item || {};
    const tokenFromDb = String(it.oauthAccessToken?.S || it.accessToken?.S || '');
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
    try { console.log('[api/x/tweet] token_present_from_db:', !!tokenFromDb, 'using_fallback:', usingFallback, 'oauthSavedAt:', it.oauthSavedAt?.S || null); } catch(_) {}
    if (!token) return res.status(403).json({ error: 'no_token' });

    // forward to X API
    const r = await fetch('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      try { console.warn('[api/x/tweet] external API error', { status: r.status, body: j }); } catch(_) {}
      return res.status(500).json({ error: 'post_failed', detail: j });
    }
    try { console.log('[api/x/tweet] posted', { status: r.status, body: j }); } catch(_) {}
    return res.status(200).json(j);
  } catch (e: any) { return res.status(500).json({ error: String(e) }); }
}


