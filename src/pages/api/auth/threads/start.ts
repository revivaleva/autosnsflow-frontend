import type { NextApiRequest, NextApiResponse } from "next";
import { createDynamoClient } from "@/lib/ddb";
import { logEvent, putLog } from '@/lib/logger';
import { verifyUserFromRequest } from "@/lib/auth";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = createDynamoClient();
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  // Ensure user settings exist for the requesting user
  try {
    const user = await verifyUserFromRequest(req as any);
    const userId = user.sub;
    // Use backend-core helper if available
    try {
      const repo = await import('@autosnsflow/backend-core/dist/repositories/userSettings');
      const anyRepo: any = repo;
      const fn = anyRepo.ensureUserSettingsExist || anyRepo.default?.ensureUserSettingsExist;
      if (fn && typeof fn === 'function') {
        await fn(userId);
      }
    } catch (e) {
      // fallback: create minimal record directly
      const Key = { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } };
      await ddb
        .send(
          new (require('@aws-sdk/client-dynamodb').PutItemCommand)({
            TableName: TBL_SETTINGS,
            Item: { ...Key, createdAt: { N: String(Math.floor(Date.now() / 1000)) }, updatedAt: { N: String(Math.floor(Date.now() / 1000)) }, maxThreadsAccounts: { N: "0" } },
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          })
        )
        .catch(() => {});
    }
  } catch (e) {
    // ignore if not authenticated here; downstream flow may handle auth
  }
  // Helper to treat literal 'undefined' or empty strings as not set
  const getEnv = (name: string) => {
    const v = process.env[name as keyof NodeJS.ProcessEnv];
    if (!v) return undefined;
    if (String(v).trim() === "" || String(v).trim().toLowerCase() === "undefined") return undefined;
    return String(v).trim();
  };

  // Do not rely on environment vars for clientId/clientSecret; prefer DB-stored per-account values
  let clientId = "";
  // Prefer production redirect if provided, otherwise use local override, then fallback to threadsbooster default
  // Prefer NEXT_PUBLIC_* for client-exposed production redirect, but fall back to server-only key if not set
  let redirectUri =
    getEnv('NEXT_PUBLIC_THREADS_OAUTH_REDIRECT_PROD') || getEnv('THREADS_OAUTH_REDIRECT_PROD') ||
    getEnv('THREADS_OAUTH_REDIRECT_LOCAL') ||
    'http://localhost:3000/api/auth/threads/callback';

  // Defensive: trim then ensure redirectUri is an absolute http(s) URL. If not, fall back to safe default.
  try {
    redirectUri = String(redirectUri).trim();
    if (typeof redirectUri !== 'string' || !/^https?:\/\//i.test(redirectUri)) {
      // debug warn removed
      redirectUri = 'https://threadsbooster.jp/api/auth/threads/callback';
    }
  } catch (e) {
    redirectUri = 'https://threadsbooster.jp/api/auth/threads/callback';
  }

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
        const it = (out as unknown as { Item?: Record<string, { S?: string }> }).Item || {};
        if (it.clientId && it.clientId.S) {
          clientId = it.clientId.S;
        }
    } catch (e) {
        // debug warn removed
      }
    }

    // If still no clientId, try user settings default
    if (!clientId && userId) {
      try {
        const out = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } } }));
        const it = (out as unknown as { Item?: Record<string, { S?: string }> }).Item || {};
        if (it.defaultThreadsClientId && it.defaultThreadsClientId.S) clientId = it.defaultThreadsClientId.S;
      } catch (e) {
        // debug warn removed
      }
    }
  } catch (e) {
    // debug warn removed
  }

  if (!clientId) {
    return res.status(400).send("client_id not configured");
  }

  // include accountId in state so callback can map to account
  const stateObj = { s: Math.random().toString(36).slice(2), a: accountId || null };
  const state = Buffer.from(JSON.stringify(stateObj)).toString("base64");
  const scope = encodeURIComponent(
    "threads_basic,threads_manage_insights,threads_manage_replies,threads_read_replies,threads_delete,threads_content_publish"
  );
  // Coerce values to string to satisfy TypeScript strictness for encodeURIComponent
  // Threads requires the www host; use full www URL for authorize endpoint
  const url = `https://www.threads.net/oauth/authorize?client_id=${encodeURIComponent(String(clientId))}&response_type=code&redirect_uri=${encodeURIComponent(String(redirectUri))}&scope=${scope}&state=${encodeURIComponent(String(state))}`;
  // If caller requested JSON (raw) or prefers JSON, return the auth URL instead of redirecting.
  // This allows the client to copy the auth_url to clipboard without performing a redirect fetch.
  if (req.query.raw === '1' || (req.headers.accept || '').includes('application/json')) {
    return res.status(200).json({ auth_url: url });
  }
  // Debug log: output resolved values and the URL so frontend/local dev can inspect
  // NOTE: do not log any secrets
  // debug output removed
  try {
    await putLog({ action: 'threads_start', status: 'info', message: 'oauth start', detail: { redirectUri, hasProd: !!process.env.THREADS_OAUTH_REDIRECT_PROD, q: req.query } });
  } catch (e) {
    console.warn('[oauth:start] putLog failed', e);
  }
  res.redirect(url);
  return;
}


