// /src/pages/api/auth/login.ts
// [ADD] Cognitoで認証 → セッションクッキーを発行（または任意のトークンを保存）
import type { NextApiRequest, NextApiResponse } from "next";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { createDynamoClient } from "@/lib/ddb";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";

const REGION = process.env.COGNITO_REGION || process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";
const USER_POOL_CLIENT_ID =
  process.env.COGNITO_CLIENT_ID || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "";

const client = new CognitoIdentityProviderClient({ region: REGION });

function cookieSerialize(name: string, value: string, maxAgeSec: number) {
  const attrs = [
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`, // [FIX] 同一サイト遷移で付与される
    `Max-Age=${maxAgeSec}`,
  ];
  return `${name}=${encodeURIComponent(value)}; ${attrs.join("; ")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email / password is required" });

  try {
    // Cognito 認証（USER_PASSWORD_AUTH）
    const out = await client.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: USER_POOL_CLIENT_ID,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      })
    );

    const idToken = out.AuthenticationResult?.IdToken;
    if (!idToken) return res.status(401).json({ error: "Invalid credentials" });

    // [FIX] Cookie設定（1日）
    res.setHeader("Set-Cookie", cookieSerialize("idToken", idToken, 60 * 60 * 24));

    // Create UserSettings record immediately on login if missing
    try {
      const ddb = createDynamoClient();
      // Attempt to load AppConfig defaults for prompts
      let masterDefault = "";
      let replyDefault = "";
      try {
        const cfg = await import("@/lib/config");
        await cfg.loadConfig();
        masterDefault = cfg.getConfigValue("MASTER_PROMPT") || "";
        replyDefault = cfg.getConfigValue("REPLY_PROMPT") || "";
      } catch (e) {
        // ignore - fall back to empty strings
      }

      const userId = idToken ? JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8")).sub : null;
      if (userId) {
        const Key = { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } };
        await ddb
          .send(
            new PutItemCommand({
              TableName: process.env.TBL_SETTINGS || "UserSettings",
              Item: {
                ...Key,
                createdAt: { N: String(Math.floor(Date.now() / 1000)) },
                updatedAt: { N: String(Math.floor(Date.now() / 1000)) },
                maxThreadsAccounts: { N: "0" },
                masterPrompt: { S: masterDefault || "" },
                replyPrompt: { S: replyDefault || "" },
              },
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            })
          )
          .catch(() => {
            // ignore if already exists or any conditional failure
          });
      }
    } catch (e) {
      console.error("create user-settings on login failed:", e?.message || e);
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
}
