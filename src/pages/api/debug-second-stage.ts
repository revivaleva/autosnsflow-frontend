// /src/pages/api/debug-second-stage.ts
// 二段階投稿のデバッグ用API
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method === "POST") {
      // Lambda関数を呼び出して二段階投稿のデバッグ情報を取得
      const lambdaUrl = process.env.LAMBDA_INVOKE_URL || "";
      
      if (!lambdaUrl) {
        return res.status(500).json({ error: "Lambda URL not configured" });
      }

      const lambdaResponse = await fetch(lambdaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job: "debug-second-stage",
          userId: userId,
        }),
      });

      if (!lambdaResponse.ok) {
        throw new Error(`Lambda error: ${lambdaResponse.status}`);
      }

      const lambdaResult = await lambdaResponse.json();
      return res.status(200).json(lambdaResult);
    }

    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    console.error("debug-second-stage error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: e?.message || "Unknown error"
    });
  }
}
