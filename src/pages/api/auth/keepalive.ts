// /src/pages/api/auth/keepalive.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';

function getCookie(req: NextApiRequest, name: string): string | null {
  const c = req.headers.cookie;
  if (!c) return null;
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function cookieSerialize(name: string, value: string, maxAgeSec: number) {
  const attrs = [
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=${maxAgeSec}`,
  ];
  return `${name}=${encodeURIComponent(value)}; ${attrs.join('; ')}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const idToken = getCookie(req, 'idToken');
  if (!idToken) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    const payload: any = jwt.decode(idToken);
    const sub = payload?.sub ?? payload?.userId ?? null;
    if (!sub) { res.status(401).json({ error: 'Unauthorized' }); return; }

    // Re-issue the idToken cookie to extend session (1 day)
    res.setHeader('Set-Cookie', cookieSerialize('idToken', idToken, 60 * 60 * 24));
    res.status(200).json({ ok: true, sub });
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}


