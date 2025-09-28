import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // accountId may be passed so we can choose per-account clientId
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
  const clientId = process.env.THREADS_CLIENT_ID || process.env.THREADS_APP_ID || ""; // fallback; actual selection happens in callback
  const redirectUri = process.env.THREADS_OAUTH_REDIRECT_LOCAL || (process.env.NODE_ENV === 'production' ? process.env.THREADS_OAUTH_REDIRECT_PROD : 'http://localhost:3000/api/auth/threads/callback');
  // include accountId in state so callback can map to account
  const stateObj = { s: Math.random().toString(36).slice(2), a: accountId || null };
  const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');
  const scope = encodeURIComponent('threads_basic,threads_delete');
  const url = `https://www.facebook.com/v16.0/dialog/oauth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=${encodeURIComponent(state)}`;
  res.redirect(url);
}


