// /src/pages/api/auth/me.ts
// [ADD] ログインユーザー情報＆管理者判定（Admins などのグループで判定）
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyUserFromRequest } from "@/lib/auth";
import { env } from "@/lib/env";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const user = await verifyUserFromRequest(req);
    const raw = user["cognito:groups"];
    const groups = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    const expected = (env as any).ADMIN_GROUP || "Admins"; // env.ADMIN_GROUP が未定義なら "Admins"

    const isAdmin = groups.includes(expected);

    return res.status(200).json({
      ok: true,
      isAdmin,
      sub: user.sub,
      email: user.email || null,
      groups,
    });
  } catch (e: any) {
    const code = e?.statusCode || 401;
    return res.status(code).json({ error: e?.message || "Unauthorized" });
  }
}
