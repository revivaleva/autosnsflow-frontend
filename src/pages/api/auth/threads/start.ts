import type { NextApiRequest, NextApiResponse } from "next";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = createDynamoClient();
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  let clientId = process.env.THREADS_CLIENT_ID || process.env.THREADS_APP_ID || "";
  // Prefer production redirect if provided, otherwise use local override, then fallback to localhost
  const redirectUri =
    process.env.THREADS_OAUTH_REDIRECT_PROD ||
    process.env.THREADS_OAUTH_REDIRECT_LOCAL ||
    (process.env.NODE_ENV === "production"
      ? process.env.THREADS_OAUTH_REDIRECT_PROD
      : "http://localhost:3000/api/auth/threads/callback");

  // Try to resolve clientId from DB (account-specific), then user settings, then env
  try {
    let userId: string | null = null;
    try {
      const user = await verifyUserFromRequest(req);
      userId = user?.sub || null;
    } catch (e) {
      // verifyUserFromRequest may fail for unauthenticated requests; fall back to cookie if present
      userId = req.cookies["__session"] || null;
    }

    if (accountId && userId) {
      try {
        const out = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
        const it: any = out.Item || {};
        if (it.clientId && it.clientId.S) {
          clientId = it.clientId.S;
        }
      } catch (e) {
        console.log("[oauth:start] read account failed", e);
      }
    }

    // If still no clientId, try user settings default
    if (!clientId && userId) {
      try {
        const out = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } } }));
        const it: any = out.Item || {};
        if (it.defaultThreadsClientId && it.defaultThreadsClientId.S) clientId = it.defaultThreadsClientId.S;
      } catch (e) {
        console.log("[oauth:start] read settings failed", e);
      }
    }
  } catch (e) {
    console.log("[oauth:start] clientId resolution error", e);
  }

  if (!clientId) {
    return res.status(400).send("client_id not configured");
  }

  // include accountId in state so callback can map to account
  const stateObj = { s: Math.random().toString(36).slice(2), a: accountId || null };
  const state = Buffer.from(JSON.stringify(stateObj)).toString("base64");
  const scope = encodeURIComponent(
    "threads_basic,threads_manage_insights,threads_manage_replies,threads_read_replies,threads_delete"
  );
  // Coerce values to string to satisfy TypeScript strictness for encodeURIComponent
  const url = `https://threads.net/oauth/authorize?client_id=${encodeURIComponent(String(clientId))}&response_type=code&redirect_uri=${encodeURIComponent(String(redirectUri))}&scope=${scope}&state=${encodeURIComponent(String(state))}`;
  // If caller requested JSON (raw) or prefers JSON, return the auth URL instead of redirecting.
  // This allows the client to copy the auth_url to clipboard without performing a redirect fetch.
  if (req.query.raw === '1' || (req.headers.accept || '').includes('application/json')) {
    return res.status(200).json({ auth_url: url });
  }
  // Debug log: output resolved values and the URL so frontend/local dev can inspect
  console.log("[oauth:start] resolved", { accountId, clientId, redirectUri, state: stateObj });
  console.log("[oauth:start] auth_url: ", url);
  res.redirect(url);
}


