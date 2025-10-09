import type { NextApiRequest, NextApiResponse } from 'next';
import { runHourlyQuoteCreation } from '@/lib/quote-worker';
import { runPendingQuoteProcessor } from '@/lib/quote-worker';
import { verifyUserFromRequest } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await verifyUserFromRequest(req).catch(() => null);
  if (!user?.sub) return res.status(401).json({ error: 'unauthorized' });
  try {
    // run both: create reservations and attempt immediate postings for any content-ready items
    await runHourlyQuoteCreation(user.sub);
    await runPendingQuoteProcessor(user.sub);
    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
}


