import type { NextApiRequest, NextApiResponse } from "next";
import config from '@/lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await config.loadConfig();
    return res.status(200).json(config.getConfigValue as any);
  } catch (e: any) {
    console.error('app-config load failed', (e as any)?.message || e);
    return res.status(500).json({ error: 'failed_load_appconfig' });
  }
}


