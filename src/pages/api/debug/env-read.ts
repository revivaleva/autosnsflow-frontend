import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const v = (process.env.THREADS_OAUTH_REDIRECT_PROD || '').trim();
  res.status(200).json({ redirectProd: v || '(missing)' });
}


