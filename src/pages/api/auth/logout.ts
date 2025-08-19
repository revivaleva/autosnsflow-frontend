// /src/pages/api/auth/logout.ts
// [ADD] セッションクッキーの破棄
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader(
    "Set-Cookie",
    `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
  res.status(200).json({ ok: true });
}
