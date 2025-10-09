import { getTokenForAccount } from '@/lib/threads-delete';

const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';

export async function fetchUserReplies({ userId, accountId, limit = 100 }: { userId: string; accountId: string; limit?: number }) {
  if (!userId) throw new Error('userId required');
  if (!accountId) throw new Error('accountId required');

  const token = await getTokenForAccount({ userId, accountId });
  if (!token) throw new Error('missing_oauth_access_token');

  const fields = ['id','text','timestamp','reply_to','user_id','username','permalink'];
  const tryUrls = [
    `${BASE}/me/replies?limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`,
    `${BASE}/me/threads?include_replies=true&limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`
  ];

  let results: any[] = [];
  for (const u of tryUrls) {
    try {
      const resp = await fetch(u + `&access_token=${encodeURIComponent(token)}`);
      const text = await resp.text().catch(() => '');
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { rawText: text }; }
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
  return out;
}

export default fetchUserReplies;


