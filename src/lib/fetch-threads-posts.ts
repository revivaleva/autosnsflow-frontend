import { getTokenForAccount } from '@/lib/threads-delete';

const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';

export async function fetchThreadsPosts({ userId, accountId, limit = 100 }: { userId: string; accountId: string; limit?: number }) {
  if (!userId) throw new Error('userId required');
  if (!accountId) throw new Error('accountId required');

  const token = await getTokenForAccount({ userId, accountId });
  if (!token) {
    // mark account as needing reauth and surface consistent error
    throw new Error('missing_oauth_access_token');
  }

  // Request additional fields to capture replies/quoted content and referenced posts
  // We'll request a superset and then normalize the returned objects
  const fields = ['id','shortcode','timestamp','text','reply_to','referenced_posts','reply_count','user_id','root_id'];
  const url = `${BASE}/me/threads?limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`;
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
    let arr: any[] = Array.isArray(data?.data) ? data.data : [];
    // Try additional endpoints that may expose replies authored by the user.
    // Some API versions expose /me/replies or allow include_replies flag. Probe these and merge results.
    try {
      const tryUrls = [
        `${BASE}/me/replies?limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`,
        `${BASE}/me/threads?include_replies=true&limit=${encodeURIComponent(String(limit))}&fields=${encodeURIComponent(fields.join(','))}`
      ];
      for (const tryUrl of tryUrls) {
        try {
          const r = await fetch(tryUrl + `&access_token=${encodeURIComponent(token)}`);
          const txt = await r.text().catch(() => '');
          let d: any = {};
          try { d = txt ? JSON.parse(txt) : {}; } catch { d = { rawText: txt }; }
          if (r.ok && Array.isArray(d?.data) && d.data.length > 0) {
            // merge unique by id
            const incoming: any[] = d.data;
            const existingIds = new Set(arr.map(x => String(x.id)));
            for (const it of incoming) {
              if (!existingIds.has(String(it.id))) arr.push(it);
            }
          }
        } catch (_) { /* ignore individual probe errors */ }
      }
    } catch (_) {}
    // Normalize items: include available reply/quote metadata
    return arr.map((it: any) => ({
      id: it.id,
      shortcode: it.shortcode,
      timestamp: it.timestamp,
      text: it.text || '',
      replyTo: it.reply_to || null,
      referencedPosts: it.referenced_posts || [],
      replyCount: it.reply_count || 0,
      userIdOnPlatform: it.user_id || it.owner_id || null,
      rootId: it.root_id || null,
      raw: it
    }));
  } catch (e: any) {
    throw e;
  }
}

export default fetchThreadsPosts;


