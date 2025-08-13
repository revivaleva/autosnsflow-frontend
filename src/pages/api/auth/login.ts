// /src/pages/api/auth/login.ts
// [MOD] サーバサイドは COGNITO_* を優先し、なければ NEXT_PUBLIC_* を利用
import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/lib/env"; // [ADD]
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({ region: env.AWS_REGION });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const USER_POOL_ID = env.COGNITO_USER_POOL_ID;   // [MOD]
  const CLIENT_ID    = env.COGNITO_CLIENT_ID;      // [MOD]
  if (!USER_POOL_ID) return res.status(500).json({ error: "Cognito UserPoolId is missing" }); // [ADD]
  if (!CLIENT_ID)    return res.status(500).json({ error: "Cognito ClientId is missing" });   // [ADD]

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email/password required" });

  try {
    const resp = await client.send(new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));

    const idToken = resp.AuthenticationResult?.IdToken;
    if (!idToken) return res.status(401).json({ error: "Unauthorized" });

    // HttpOnly Cookie 発行
    res.setHeader("Set-Cookie", [
      `idToken=${encodeURIComponent(idToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`
    ]);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(401).json({ error: e?.message || "auth_failed" });
  }
}
