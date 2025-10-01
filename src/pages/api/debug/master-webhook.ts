import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const val = process.env.MASTER_DISCORD_WEBHOOK || '';
    return res.status(200).json({ value: val });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}


