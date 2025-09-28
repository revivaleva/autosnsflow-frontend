import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.THREADS_CLIENT_ID || process.env.THREADS_APP_ID || "";
  const redirectUri = process.env.THREADS_OAUTH_REDIRECT_LOCAL || (process.env.NODE_ENV === 'production' ? process.env.THREADS_OAUTH_REDIRECT_PROD : 'http://localhost:3000/api/auth/threads/callback');
  const state = Math.random().toString(36).slice(2);
  const scope = encodeURIComponent('threads_basic,threads_delete');
  const url = `https://www.facebook.com/v16.0/dialog/oauth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=${encodeURIComponent(state)}`;
  res.redirect(url);
}


