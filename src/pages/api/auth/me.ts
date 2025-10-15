// /src/pages/api/auth/me.ts
// [ADD]/ [MOD] 認証は idToken クッキーのみを見る
import type { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';

function getCookie(req: NextApiRequest, name: string): string | null {
  const c = req.headers.cookie;
  if (!c) return null;
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const idToken = getCookie(req, 'idToken'); // ← ここを idToken 固定
  if (!idToken) { res.status(401).json({ message: 'Unauthorized' }); return; }

  try {
    const payload: any = jwt.decode(idToken);
    const sub = payload?.sub ?? payload?.userId ?? null;
    if (!sub) { res.status(401).json({ message: 'Unauthorized' }); return; }

    // 必要最低限の返却（adminFlag.ts が期待する形に合わせる）
    // Cognito の token に含まれる cognito:groups を確認して isAdmin を返す
    const groups = payload?.['cognito:groups'] || payload?.['cognito.groups'] || [];
    const groupsArr = Array.isArray(groups) ? groups : String(groups).split(',');
    const isAdmin = groupsArr.includes(process.env.NEXT_PUBLIC_ADMIN_GROUP || process.env.ADMIN_GROUP || 'Admins');
    res.status(200).json({ ok: true, sub, isAdmin });
  } catch (e) {
    res.status(401).json({ message: 'Unauthorized' }); return;
  }
}
