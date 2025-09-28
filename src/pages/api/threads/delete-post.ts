import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, DeleteItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_THREADS = "ThreadsAccounts";
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_LOGS = "ExecutionLogs";

async function putLog({ userId = "unknown", type, accountId = "", targetId = "", status = "info", message = "", detail = {} }: any) {
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
    console.log("[warn] putLog skipped:", String((e as Error)?.message || e));
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
    const acc = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: "accessToken" }));
    const accessToken = acc.Item?.accessToken?.S || "";
    if (!accessToken) {
      await putLog({ userId, type: "delete-post", accountId, targetId: numericPostId, status: "error", message: "accessToken missing" });
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
      console.log('[delete-post] todayDeletes for account', accountId, todayDeletes);
      if (todayDeletes >= 100) {
        await putLog({ userId, type: 'delete-post', accountId, targetId: numericPostId, status: 'warn', message: 'daily delete limit reached' });
        return res.status(429).json({ ok: false, error: 'daily delete limit reached (100)', remaining: 0 });
      }
    } catch (e) {
      console.log('[warn] count today deletes failed', e);
    }

    // Call Threads delete API
    const url = `https://graph.threads.net/v1.0/${encodeURIComponent(numericPostId)}?access_token=${encodeURIComponent(accessToken)}`;
    console.log("[delete-post] calling threads delete", { url: url.slice(0, 120) });
    const resp = await fetch(url, { method: "DELETE" });
    const text = await resp.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

    // always log response for debugging
    console.log('[delete-post] threads response', { status: resp.status, body: json });

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
        console.log('[warn] scheduled record delete failed', e);
      }
    }

    await putLog({ userId, type: "delete-post", accountId, targetId: numericPostId, status: success ? 'ok' : 'warn', message: 'deleted via threads API', detail: { threadsResp: json, deletedScheduled } });

    return res.status(200).json({ ok: true, deletedCount: success ? 1 : 0, deletedScheduled, detail: json });
  } catch (e: any) {
    console.error('delete-post error', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}


