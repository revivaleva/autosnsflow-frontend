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

    // Call Threads delete API
    const url = `https://graph.threads.net/v1.0/${encodeURIComponent(numericPostId)}?access_token=${encodeURIComponent(accessToken)}`;
    console.log("[delete-post] calling threads delete", { url: url.slice(0, 120) });
    const resp = await fetch(url, { method: "DELETE" });
    const text = await resp.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

    // always log response for debugging
    console.log('[delete-post] threads response', { status: resp.status, body: json });

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


