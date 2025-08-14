// /src/pages/api/auth/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

const cookieNames = [
  "idToken", "id_token",
  "accessToken", "access_token",
  "refreshToken", "refresh_token",
];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const host = req.headers.host?.split(":")[0] || "";

  const set = (name: string, domain?: string) => {
    res.setHeader("Set-Cookie", [
      `${name}=; Max-Age=0; Path=/; ${domain ? `Domain=.${domain}; ` : ""}`,
      `${name}=; Max-Age=0; Path=/; ${domain ? `Domain=.${domain}; ` : ""}Secure; SameSite=None`,
    ]);
  };

  cookieNames.forEach((n) => {
    set(n);                 // host-only
    if (host) set(n, host); // domain付き
  });

  res.status(200).json({ ok: true });
}
