// /src/pages/api/auth/me.ts
// [ADD] 現在のログイン情報を返す。isAdmin 判定を含む。
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyUserFromRequest } from "@/lib/auth";
import { env } from "@/lib/env";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
  try {
    const user = await verifyUserFromRequest(req); // Cookie/BearerからCognito検証
    const raw = (user["cognito:groups"] ?? []) as any;
    const groups = Array.isArray(raw) ? raw : String(raw || "").split(",");
    const isAdmin = groups.includes(env.ADMIN_GROUP || "Admins");
    res.status(200).json({ ok: true, isAdmin, sub: user.sub, email: user.email || "" });
  } catch (e: any) {
    res.status(e?.statusCode || 401).json({ ok: false, error: e?.message || "unauthorized" });
  }
}
