// /src/pages/api/replies/send.ts
// リプライ送信API
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postReplyViaThreads } from "@/lib/replies/common";

const ddb = createDynamoClient();
const TBL_REPLIES = "Replies";
const TBL_THREADS = "ThreadsAccounts";

// GAS/Lambda準拠のThreads投稿関数（リプライ対応）
async function postToThreads({ accessToken, text, userIdOnPlatform, inReplyTo }: {
  accessToken: string;
  text: string;
  userIdOnPlatform: string;
  inReplyTo?: string;
}): Promise<{ postId: string }> {
  if (!accessToken) throw new Error("Threads accessToken 未設定");
  if (!userIdOnPlatform) throw new Error("Threads userId 未設定");

  const base = `https://graph.threads.net/v1.0/${encodeURIComponent(userIdOnPlatform)}`;

  // コンテナ作成（GAS/Lambda同様）
  const createPayload: any = {
    media_type: "TEXT",
    text,
    access_token: accessToken,
  };
  
  if (inReplyTo) {
    createPayload.replied_to_id = inReplyTo;
  }

  let createRes = await fetch(`${base}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createPayload),
  });

  // エラー時のリトライ（Lambda準拠）
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    console.warn(`[WARN] Threads create失敗、リトライ: ${createRes.status} ${errText}`);
    
    // パラメータ調整してリトライ
    const retryPayload = { ...createPayload };
    if (inReplyTo) {
      // replied_to_idの代替フィールド名を試行
      delete retryPayload.replied_to_id;
      retryPayload.reply_to_id = inReplyTo;
    }
    
    const retried = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(retryPayload),
    });
    
    if (!retried.ok) {
      const err2 = await retried.text().catch(() => "");
      throw new Error(
        `Threads create error: first=${createRes.status} ${errText} / retry=${retried.status} ${err2}`
      );
    }
    createRes = retried;
  }

  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    throw new Error(`Threads create error: ${createRes.status} ${t}`);
  }

  const createJson = await createRes.json().catch(() => ({}));
  const creation_id = createJson?.id;
  if (!creation_id) throw new Error("Threads creation_id 取得失敗");

  // Publish: use containerId (creation_id) directly -> POST /v1.0/{containerId}/publish
  const graphBase = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';
  const publishUrl = `${graphBase}/${encodeURIComponent(creation_id)}/publish`;

  // debug output removed

  // Try publish with same access token; allow up to 2 retries (total attempts 3) if transient/permission-like errors occur
  let pubRes: any = null;
  let pubText = '';
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      pubRes = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      pubText = await pubRes.text().catch(() => '');
      // send debug to discord for each attempt
      try {
        // debug webhook removed
      } catch (_) {}

      if (pubRes.ok) break;

      // if 400 with permission/resource message, allow retry (we've already implemented detection in lib/threads; replicate simple heuristic)
      const lower = String(pubText || '').toLowerCase();
      const retryable400 = pubRes.status === 400 && (lower.includes('unsupported post request') || lower.includes('missing permissions') || lower.includes('does not exist'));
      const retryableAuth = pubRes.status === 401 || pubRes.status === 403 || retryable400;
      if (!retryableAuth || attempt === maxAttempts) break;
      // wait a bit before retry
      await new Promise((res) => setTimeout(res, 500));
    } catch (e) {
      pubText = String((e as any)?.message || e);
      if (attempt === maxAttempts) break;
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  if (!pubRes || !pubRes.ok) {
    throw new Error(`Threads publish error: ${pubRes?.status || 'no_response'} ${pubText}`);
  }

  let pubJson = {} as any;
  try { pubJson = JSON.parse(pubText || '{}'); } catch {}
  const postId = pubJson?.id || creation_id;
  return { postId };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { replyId, replyContent } = req.body || {};
    
    if (!replyId || !replyContent?.trim()) {
      return res.status(400).json({ error: "replyId and replyContent are required" });
    }

    // リプライ情報を取得
    const replyItem = await ddb.send(new GetItemCommand({
      TableName: TBL_REPLIES,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `REPLY#${replyId}` }
      },
    }));

    if (!replyItem.Item) {
      return res.status(404).json({ error: "Reply not found" });
    }

    const accountId = replyItem.Item.accountId?.S;
    const postId = replyItem.Item.postId?.S; // リプライ先のpostId
    const currentStatus = replyItem.Item.status?.S;

    if (!accountId) {
      return res.status(400).json({ error: "Invalid reply data: missing accountId" });
    }

    if (currentStatus === "replied") {
      return res.status(400).json({ error: "Reply already sent" });
    }

    // アカウント情報（アクセストークン・providerUserId）を取得
    const accountItem = await ddb.send(new GetItemCommand({
      TableName: TBL_THREADS,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `ACCOUNT#${accountId}` }
      },
      ProjectionExpression: "accessToken, oauthAccessToken, providerUserId",
    }));

    if (!accountItem.Item) {
      return res.status(404).json({ error: "Account not found" });
    }

    const accessToken = accountItem.Item.accessToken?.S;
    const oauthAccessToken = accountItem.Item.oauthAccessToken?.S;
    const providerUserId = accountItem.Item.providerUserId?.S;

    if (!accessToken || !providerUserId) {
      return res.status(400).json({ error: "Account missing accessToken or providerUserId" });
    }

    // デバッグログ追加（ALLOW_DEBUG_EXEC_LOGS で制御）
    const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
    // debug output removed

    // Threadsにリプライを投稿（共通関数を使用）
    const { postId: responsePostId } = await postReplyViaThreads({
      accessToken: accessToken || undefined,
      oauthAccessToken: oauthAccessToken || undefined,
      providerUserId,
      inReplyTo: postId, // 元の投稿IDにリプライ
      text: replyContent,
    });

    // debug output removed

    // DBのステータスを更新
    const now = Math.floor(Date.now() / 1000);
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_REPLIES,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `REPLY#${replyId}` }
      },
      UpdateExpression: "SET #st = :replied, replyAt = :ts, responseContent = :resp, responsePostId = :pid",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":replied": { S: "replied" },
        ":ts": { N: String(now) },
        ":resp": { S: replyContent },
        ":pid": { S: responsePostId },
      },
      ConditionExpression: "#st <> :replied", // 重複防止
    }));

    return res.status(200).json({
      ok: true,
      responsePostId,
      message: "リプライを送信しました"
    });

  } catch (e: any) {
    console.error("replies/send error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: e?.message || "Unknown error"
    });
  }
}
