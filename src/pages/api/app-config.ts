import type { NextApiRequest, NextApiResponse } from 'next';
import { loadConfig } from '@/lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const cfg = await loadConfig();
    return res.status(200).json(cfg || {});
  } catch (e: any) {
    return res.status(500).json({ error: String(e) });
  }
}


