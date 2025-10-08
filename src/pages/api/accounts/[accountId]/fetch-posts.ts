import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyUserFromRequest } from '@/lib/auth';
import { fetchUserPosts } from '@/lib/fetch-user-posts';
import { fetchThreadsPosts } from '@/lib/fetch-threads-posts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const user = await verifyUserFromRequest(req);
    // debug logs removed
    const userId = user.sub;
    const accountId = Array.isArray(req.query.accountId) ? req.query.accountId[0] : req.query.accountId;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    // Fetch from Threads API only (no fallback)
    const threads = await fetchThreadsPosts({ userId, accountId: String(accountId), limit });
    try { /* debug output removed */ } catch (_) {}
    return res.status(200).json({ ok: true, source: 'threads', posts: threads, count: threads.length });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
  }
}


