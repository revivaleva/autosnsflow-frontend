import type { NextApiRequest, NextApiResponse } from 'next';
import { runHourlyQuoteCreation } from '@/lib/quote-worker';
import { verifyUserFromRequest } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await verifyUserFromRequest(req).catch(() => null);
  if (!user?.sub) return res.status(401).json({ error: 'unauthorized' });
  try {
    await runHourlyQuoteCreation(user.sub);
    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
}


