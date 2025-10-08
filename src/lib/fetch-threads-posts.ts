import { getTokenForAccount } from '@/lib/threads-delete';

const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';

export async function fetchThreadsPosts({ userId, accountId, limit = 100 }: { userId: string; accountId: string; limit?: number }) {
  if (!userId) throw new Error('userId required');
  if (!accountId) throw new Error('accountId required');

  const token = await getTokenForAccount({ userId, accountId });
  if (!token) throw new Error('missing_access_token');

  const url = `${BASE}/me/threads?limit=${encodeURIComponent(String(limit))}&fields=id,shortcode,timestamp`;
  try {
    const resp = await fetch(url + `&access_token=${encodeURIComponent(token)}`);
    const text = await resp.text().catch(() => '');
    // Debug: log response status and body (truncated)
    // response handled below
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { rawText: text }; }
    if (!resp.ok) {
      throw new Error(`threads_fetch_failed: ${resp.status} ${JSON.stringify(data)}`);
    }
    const arr: any[] = Array.isArray(data?.data) ? data.data : [];
    // map to minimal shape
    return arr.map((it: any) => ({ id: it.id, shortcode: it.shortcode, timestamp: it.timestamp }));
  } catch (e: any) {
    throw e;
  }
}

export default fetchThreadsPosts;


