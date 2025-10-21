import type { NextApiRequest, NextApiResponse } from "next";
import { verifyUserFromRequest, assertAdmin } from '@/lib/auth';

function cookieSerialize(name: string, value: string, maxAgeSec: number) {
  const attrs = [`Path=/`, `HttpOnly`, `SameSite=Lax`];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  if (typeof maxAgeSec === 'number') attrs.push(`Max-Age=${maxAgeSec}`);
  return `${name}=${encodeURIComponent(value)}; ${attrs.join('; ')}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'POST') {
      // set impersonation cookie
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { userId } = body || {};
      if (!userId) return res.status(400).json({ error: 'userId required' });

      const user = await verifyUserFromRequest(req);
      assertAdmin(user);

      // set cookie for 1 day
      res.setHeader('Set-Cookie', cookieSerialize('impersonateUser', String(userId), 60 * 60 * 24));
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const user = await verifyUserFromRequest(req);
      assertAdmin(user);
      // clear cookie
      res.setHeader('Set-Cookie', cookieSerialize('impersonateUser', '', -1));
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['POST', 'DELETE']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
  }
}


