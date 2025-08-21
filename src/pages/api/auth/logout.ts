// /src/pages/api/auth/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

// [ADD] idToken をサーバ側で削除して /login に 302 で戻す
export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  // ※ ログイン時と同じ属性で上書き削除するのが重要
  //   - Path=/ はログイン時と同じ
  //   - HttpOnly / SameSite=Lax / Secure は Amplify(https)運用を想定
  const cookie = [
    "idToken=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
  ];

  res.setHeader("Set-Cookie", cookie);
  res.writeHead(302, { Location: "/login" });
  res.end();
}
