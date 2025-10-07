import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, DeleteItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_THREADS = "ThreadsAccounts";
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_LOGS = "ExecutionLogs";

async function putLog({ userId = "unknown", type, accountId = "", targetId = "", status = "info", message = "", detail = {} }: any) {
  const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
  const shouldPersist = (status === 'error' && !!userId) || allowDebug;
  if (!shouldPersist) {
    // debug output removed
    return;
  }

  const item = {
    PK: { S: `USER#${userId}` },
    SK: { S: `LOG#${Date.now()}#${Math.random().toString(36).slice(2, 9)}` },
    type: { S: type || "system" },
    accountId: { S: accountId },
    targetId: { S: targetId },
    status: { S: status },
    message: { S: message },
    detail: { S: JSON.stringify(detail || {}) },
    createdAt: { N: String(Math.floor(Date.now() / 1000)) },
  };
  try {
    await ddb.send(new PutItemCommand({ TableName: TBL_LOGS, Item: item }));
  } catch (e) {
    console.warn("[warn] putLog skipped:", String((e as Error)?.message || e));
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const user = await verifyUserFromRequest(req);
    if (!user?.sub) return res.status(401).json({ error: "unauthorized" });
    const userId = user.sub;

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const scheduledPostId = body?.scheduledPostId;
    const numericPostId = body?.numericPostId;
    const accountId = body?.accountId;

    if (!numericPostId || !accountId) return res.status(400).json({ error: "numericPostId and accountId are required" });

    // fetch account accessToken
    const acc = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: "accessToken, oauthAccessToken" }));
    const accessToken = acc.Item?.accessToken?.S || "";
    const oauthAccessToken = acc.Item?.oauthAccessToken?.S || "";
    const usedToken = (oauthAccessToken && oauthAccessToken.trim()) ? oauthAccessToken : accessToken;
    if (!usedToken) {
      await putLog({ userId, type: "delete-post", accountId, targetId: numericPostId, status: "error", message: "accessToken and oauthAccessToken missing" });
      return res.status(400).json({ ok: false, error: "account access token missing" });
    }

    // Check daily deletion count (limit 100 per account per day)
    try {
      const startOfDay = Math.floor(new Date().setHours(0,0,0,0) / 1000);
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_LOGS,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'LOG#' }, ':acc': { S: accountId }, ':type': { S: 'delete-post' }, ':t0': { N: String(startOfDay) } },
        ProjectionExpression: 'createdAt,type,accountId'
      }));
      let todayDeletes = 0;
      for (const it of (q.Items || [])) {
        try {
          const t = Number(it.createdAt?.N || 0);
          const tp = it.type?.S || '';
          const aid = it.accountId?.S || '';
          if (tp === 'delete-post' && aid === accountId && t >= startOfDay) todayDeletes++;
        } catch (_) {}
      }
      // debug output removed
      if (todayDeletes >= 100) {
        await putLog({ userId, type: 'delete-post', accountId, targetId: numericPostId, status: 'warn', message: 'daily delete limit reached' });
        return res.status(429).json({ ok: false, error: 'daily delete limit reached (100)', remaining: 0 });
      }
    } catch (e) {
      console.warn('[warn] count today deletes failed', e);
    }

    // Call Threads delete API (prefer oauthAccessToken)
    const url = `https://graph.threads.net/v1.0/${encodeURIComponent(numericPostId)}?access_token=${encodeURIComponent(usedToken)}`;
    // debug output removed
    const resp = await fetch(url, { method: "DELETE" });
    const text = await resp.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

    // always log response for debugging
    // debug output removed

    // If response status is 400/401/403/404, provide clearer message
    if (resp.status === 401 || resp.status === 403) {
      await putLog({ userId, type: 'delete-post', accountId, targetId: numericPostId, status: 'error', message: 'threads auth error', detail: { status: resp.status, body: json } });
      return res.status(403).json({ ok: false, error: 'threads auth error (token may lack threads_delete or be expired)', detail: json });
    }
    if (resp.status === 404) {
      await putLog({ userId, type: 'delete-post', accountId, targetId: numericPostId, status: 'error', message: 'threads media not found', detail: json });
      return res.status(404).json({ ok: false, error: 'threads media not found', detail: json });
    }

    if (!resp.ok) {
      // handle known non-fatal cases: object missing or unsupported
      const errMsg = json?.error || json;
      const bodyStr = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg || {});
      // treat FB API error_subcode 33 (cannot be loaded / missing permissions) as non-fatal: remove scheduled record
      const isMissing = bodyStr.includes('does not exist') || bodyStr.includes('cannot be loaded') || (json?.error?.error_subcode === 33);
      if (isMissing) {
        try {
          if (scheduledPostId) {
            await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } } }));
          }
        } catch (e) {
    // debug warn removed
        }
        await putLog({ userId, type: 'delete-post', accountId, targetId: numericPostId, status: 'warn', message: 'threads media missing or unsupported - treated as deleted', detail: json });
        return res.status(200).json({ ok: true, deletedCount: 0, deletedScheduled: !!scheduledPostId, detail: json });
      }
      // include body text for easier debugging
      await putLog({ userId, type: "delete-post", accountId, targetId: numericPostId, status: "error", message: `threads delete failed ${resp.status}`, detail: { status: resp.status, body: json } });
      return res.status(500).json({ ok: false, error: `threads delete failed: ${resp.status}`, detail: json });
    }

    // consider success if response indicates success === true or HTTP 200
    const success = json?.success === true || resp.status === 200;
    if (!success) {
      await putLog({ userId, type: "delete-post", accountId, targetId: numericPostId, status: "warn", message: "threads delete reported no success", detail: json });
    }

    // If there is a scheduled record, remove it from ScheduledPosts
    let deletedScheduled = false;
    if (scheduledPostId) {
      try {
        await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } } }));
        deletedScheduled = true;
      } catch (e) {
        // debug warn removed
      }
    }

    await putLog({ userId, type: "delete-post", accountId, targetId: numericPostId, status: success ? 'ok' : 'warn', message: 'deleted via threads API', detail: { threadsResp: json, deletedScheduled } });

    return res.status(200).json({ ok: true, deletedCount: success ? 1 : 0, deletedScheduled, detail: json });
  } catch (e: any) {
    // debug error removed
    return res.status(500).json({ ok: false, error: String(e) });
  }
}


