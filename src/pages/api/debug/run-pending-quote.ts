import type { NextApiRequest, NextApiResponse } from 'next';
import { runPendingQuoteProcessor } from '@/lib/quote-worker';
import { verifyUserFromRequest } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await verifyUserFromRequest(req).catch(() => null);
  if (!user?.sub) return res.status(401).json({ error: 'unauthorized' });
  try {
    await runPendingQuoteProcessor(user.sub);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: String(e) });
  }
}


