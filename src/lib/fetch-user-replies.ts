import { getTokenForAccount } from '@/lib/threads-delete';

const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';

import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL_THREADS_ACCOUNTS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

export async function fetchUserReplies({ userId, accountId, limit = 100, providerUserId }: { userId: string; accountId: string; limit?: number; providerUserId?: string }) {
  if (!userId) throw new Error('userId required');
  if (!accountId) throw new Error('accountId required');

  const token = await getTokenForAccount({ userId, accountId });
  if (!token) throw new Error('missing_oauth_access_token');

  const fields = ['id','text','timestamp','reply_to','user_id','username','permalink'];
  const tryUrls = [
    `${BASE}/me/replies?limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`,
    `${BASE}/me/comments?limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`,
    `${BASE}/me/threads?include_replies=true&limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`
  ];

  let results: any[] = [];
  for (const u of tryUrls) {
    try {
      const probeUrl = u + `&access_token=${encodeURIComponent(token)}`;
      try { console.info('[info] fetchUserReplies probe', { userId, accountId, url: u }); } catch(_) {}
      const resp = await fetch(probeUrl);
      const text = await resp.text().catch(() => '');
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { rawText: text }; }
      try { console.info('[info] fetchUserReplies probe result', { userId, accountId, url: u, status: resp.status, ok: resp.ok, dataSummary: Array.isArray(data?.data) ? { count: data.data.length } : { keys: Object.keys(data || {}) } }); } catch(_) {}
      if (!resp.ok) {
        // Emit full error body (truncated) to CloudWatch for debugging
        try { console.warn('[warn] fetchUserReplies probe failed', { userId, accountId, url: u, status: resp.status, errorBody: JSON.stringify(data).slice(0, 2000) }); } catch(_) {}
      }
      if (resp.ok && Array.isArray(data?.data)) {
        results = results.concat(data.data);
      }
    } catch (_) { /* ignore */ }
  }

  // unique by id
  const seen = new Set<string>();
  const out: any[] = [];
  for (const it of results) {
    const id = String(it.id || it.post_id || it.reply_id || '');
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text: it.text || '', timestamp: it.timestamp, replyTo: it.reply_to || null, raw: it });
  }
  try { console.info('[info] fetchUserReplies summary', { userId, accountId, count: out.length }); } catch(_) {}
  return out;
}

export default fetchUserReplies;


