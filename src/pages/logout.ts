// /src/pages/api/logout.ts
// [ADD] Cookieを失効させるだけのシンプルなログアウトAPI
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const expired = "Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
  res.setHeader("Set-Cookie", [
    `idToken=; ${expired}`,
    `id_token=; ${expired}`,
    `accessToken=; ${expired}`,
    `refreshToken=; ${expired}`,
  ]);
  return res.status(200).json({ ok: true });
}
