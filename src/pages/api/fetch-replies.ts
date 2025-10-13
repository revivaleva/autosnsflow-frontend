// /src/pages/api/fetch-replies.ts
// 手動でリプライを取得するAPI（Lambda関数の処理を移植）

import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { fetchThreadsAccountsFull } from "@autosnsflow/backend-core";

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";
const TBL_REPLIES = process.env.TBL_REPLIES || "Replies";
const TBL_LOGS = process.env.TBL_EXECUTION_LOGS || "ExecutionLogs";

// 現在時刻（Unix秒）
const nowSec = () => Math.floor(Date.now() / 1000);

// Lambda関数の upsertReplyItem を移植（AI生成機能付き）
export async function upsertReplyItem(userId: string, acct: any, { externalReplyId, postId, text, createdAt, originalPost }: any) {
  const sk = `REPLY#${externalReplyId}`;

  // AI生成による返信内容の作成
  let responseContent = "";
  
  // 手動取得でもautoReplyが有効な場合は返信内容を生成
  if (acct.autoReply) {
    try {
      // debug output removed
      
      const aiResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/ai-gateway`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purpose: "reply-generate",
          input: {
            accountId: acct.accountId,
            originalPost: originalPost?.content || "",
            incomingReply: text,
          },
          userId: userId,
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        if (aiData.text) {
          responseContent = aiData.text.trim();
        }
      } else {
        console.warn(`[WARN] AI生成失敗: ${aiResponse.status} ${aiResponse.statusText}`);
      }
      } catch (e) {
      console.warn(`[WARN] 返信コンテンツ生成失敗: ${String(e).substring(0, 100)}`);
    }
  }

  try {
    await ddb.send(new PutItemCommand({
      TableName: TBL_REPLIES,
      Item: {
        PK: { S: `USER#${userId}` },
        SK: { S: sk },
        accountId: { S: acct.accountId },
        postId: { S: postId },
        incomingReply: { S: text },
        replyContent: { S: responseContent },
        status: { S: responseContent ? "unreplied" : "draft" },
        createdAt: { N: String(createdAt || nowSec()) },
        originalContent: { S: originalPost?.content || "" },
        originalPostedAt: { N: String(originalPost?.postedAt || 0) },
      },
      ConditionExpression: "attribute_not_exists(SK)",
    }));
    return true;
  } catch (e: any) {
    // If item already exists, treat as duplicate (no-op). Otherwise log and return false.
    if (e?.name === 'ConditionalCheckFailedException') {
      return false;
    }
    console.warn('[WARN] upsertReplyItem failed:', String(e).substring(0,200));
    return false;
  }
}

import { putLog as putLogCanonical } from '@/lib/logger';

// Adapter: reuse canonical putLog implementation
async function putLog({ userId = "", type, accountId = "", targetId = "", status = "info", message = "", detail = {} }: any) {
  try {
    await putLogCanonical({ userId: userId || undefined, accountId: accountId || undefined, action: type || 'log', status, message, detail, targetId: targetId || undefined });
  } catch (e) {
    console.warn('[putLog adapter - fetch-replies] failed', e);
  }
}

// Lambda関数の fetchThreadsRepliesAndSave を移植
export async function fetchThreadsRepliesAndSave({ acct, userId, lookbackSec = 24*3600 }: any) {
  // debug output removed
  
  // support oauthAccessToken as the canonical token field
  let hasAccessToken = !!acct?.accessToken;
  let hasOauthAccessToken = !!acct?.oauthAccessToken;
  let hasProviderUserId = !!acct?.providerUserId;

  // If tokens or providerUserId are missing, try a DynamoDB fallback read for this account
  if (!hasAccessToken && !hasOauthAccessToken) {
    try {
      const out = await ddb.send(new GetItemCommand({
        TableName: process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts',
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${acct?.accountId || ''}` } },
        ProjectionExpression: 'accessToken, oauthAccessToken, providerUserId'
      }));
      const it: any = (out as any).Item || {};
      if (it.accessToken && it.accessToken.S) acct.accessToken = it.accessToken.S;
      if (it.oauthAccessToken && it.oauthAccessToken.S) acct.oauthAccessToken = it.oauthAccessToken.S;
      if (it.providerUserId && it.providerUserId.S) acct.providerUserId = it.providerUserId.S;
    } catch (e) {
      console.warn('[WARN] fetchThreadsRepliesAndSave - fallback account read failed', e);
    }
    hasAccessToken = !!acct?.accessToken;
    hasOauthAccessToken = !!acct?.oauthAccessToken;
    hasProviderUserId = !!acct?.providerUserId;
  }

  if (!hasAccessToken && !hasOauthAccessToken) {
    // Log minimal, non-sensitive probe to server console for debugging (do not print tokens)
    console.warn(`[WARN] fetchThreadsRepliesAndSave - token missing for account: ${acct?.accountId || 'unknown'}`, { hasAccessToken, hasOauthAccessToken, acctKeys: Object.keys(acct || {}) });
    throw new Error("Threads のトークン不足");
  }
  if (!hasProviderUserId) {
    console.warn(`[WARN] fetchThreadsRepliesAndSave - providerUserId missing for account: ${acct?.accountId || 'unknown'}`, { hasProviderUserId, acctKeys: Object.keys(acct || {}) });
    throw new Error("Threads のユーザーID取得失敗");
  }
  
  const since = nowSec() - lookbackSec;
  let saved = 0;
  
  // debug output removed

  // 投稿済みの予約投稿を取得
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_SCHEDULED,
    KeyConditionExpression: "PK = :pk",
    FilterExpression: "#st = :posted AND postedAt >= :since AND accountId = :acc",
    ExpressionAttributeNames: { "#st": "status" },
    ExpressionAttributeValues: {
      ":pk": { S: `USER#${userId}` },
      ":posted": { S: "posted" },
      ":since": { N: String(since) },
      ":acc": { S: acct.accountId },
    },
    ProjectionExpression: "postId, numericPostId, content, postedAt, scheduledPostId",
  }));
  
  // debug output removed
  
  if (!q.Items || q.Items.length === 0) {
    // debug output removed
  }

  // 検証ログ: この acct に対して取得された予約投稿の件数とサンプルIDを記録（トークン等は出力しない）
  try {
    const sampleIds = (q.Items || []).slice(0,3).map(it => it.scheduledPostId?.S || it.postId?.S || '');
    console.info(`[reply-fetch-scan] acct=${acct.accountId} count=${(q.Items || []).length} sample=${JSON.stringify(sampleIds)}`);
  } catch (e) {
    console.warn('[warn] putLog(reply-fetch-scan) failed:', e);
  }

  // 上記でまとめて処理済み
  
  const postsInfo = [];
  const apiLogs = [];

  for (const item of (q.Items || [])) {
    const post = {
      postId: item.postId?.S || "",
      numericPostId: item.numericPostId?.S || "",
      content: item.content?.S || "",
      postedAt: Number(item.postedAt?.N || "0"),
      scheduledPostId: item.scheduledPostId?.S || "",
    };

  // Prepare postInfo early so skip-paths can record logs
  const postInfo: any = {
    postId: post.postId || "空",
    numericPostId: post.numericPostId || "空",
    replyApiId: null,
    content: (post.content || "").substring(0, 100),
    postedAt: post.postedAt || "空",
    hasReplyApiId: false,
    apiLog: ""
  };

  // リプライ取得用のIDを決定（numericPostId のみを許可。shortcode は使用しない）
  const isNumericPostId = post.numericPostId && /^\d+$/.test(post.numericPostId);

  let replyApiId: string | null = null;
  if (isNumericPostId) {
    replyApiId = post.numericPostId;
  } else {
    // numericPostId が無ければショートコードは使わずスキップする
    postInfo.apiLog = 'SKIP: numericPostId が存在しないためスキップ (shortcode は使用しない)';
    postsInfo.push(postInfo);
    continue;
  }

  // attach resolved replyApiId to postInfo
  postInfo.replyApiId = replyApiId || "空";
  postInfo.hasReplyApiId = !!replyApiId;

    if (!replyApiId) {
      postInfo.apiLog = "SKIP: リプライ取得用ID無し";
      postsInfo.push(postInfo);
      continue;
    }

    // リプライの取得を試行（自動リプライの除外は後で追加）
    let attempt = 0;
    const maxRetries = 3;
    while (attempt < maxRetries) {
      try {
        // 方法1: GAS同様の直接リプライ取得（replyApiId使用）
        // include is_reply_owned_by_me to enable reliable self-reply detection
        const tokenToUse = acct.oauthAccessToken || acct.accessToken || '';
        let url = `https://graph.threads.net/v1.0/${encodeURIComponent(replyApiId)}/replies?fields=id,text,username,permalink,is_reply_owned_by_me&access_token=${encodeURIComponent(tokenToUse)}`;
        
        // debug output removed
        
        let r = await fetch(url);
        
        // 方法1が失敗した場合、conversation エンドポイントを試行
        if (!r.ok && attempt === 0) {
          // debug output removed
          url = `https://graph.threads.net/v1.0/${encodeURIComponent(replyApiId)}/conversation?fields=id,text,username,permalink,is_reply_owned_by_me&access_token=${encodeURIComponent(tokenToUse)}`;
          r = await fetch(url);
          // 代替IDがある場合は再試行
          if (!r.ok && post.numericPostId && post.postId && post.numericPostId !== post.postId) {
            const alternativeId = post.numericPostId === replyApiId ? post.postId : post.numericPostId;
            // debug output removed
            url = `https://graph.threads.net/v1.0/${encodeURIComponent(alternativeId)}/replies?fields=id,text,username,permalink&access_token=${encodeURIComponent(tokenToUse)}`;
            r = await fetch(url);
          }
        }
      
        const apiLogEntry: {
          postId: string;
          numericPostId: string;
          replyApiId: string;
          url: string;
          status: string;
          content: string;
          error?: string;
          repliesFound?: number;
          response?: string;
        } = {
          postId: post.postId,
          numericPostId: post.numericPostId,
          replyApiId: replyApiId,
          url: url.replace(acct.accessToken, "***TOKEN***"),
          status: `${r.status} ${r.statusText}`,
          content: post.content.substring(0, 50)
        };
        
        if (!r.ok) { 
          const errorText = await r.text();
          console.error(`[ERROR] API失敗 (試行${attempt + 1}): ${r.status} ${r.statusText} - ${errorText.substring(0, 100)}`);
          if (errorText.includes("Address unavailable") || r.status >= 500) {
            attempt++;
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue; // while ループを続行
            }
          }
          apiLogEntry.error = `${r.status} - ${errorText.substring(0, 100)}`;
          postInfo.apiLog = `ERROR: 全手法失敗 ${r.status} ${errorText.substring(0, 50)}`;
          apiLogs.push(apiLogEntry);
          postsInfo.push(postInfo);
          break; // while ループを抜けて次の投稿へ
        }
      
        // 成功時の処理 - GASと同じシンプルなアプローチ
        const json = await r.json();
        const repliesFound = json?.data || [];
        // debug output removed
        const repliesCount = repliesFound.length;
        apiLogEntry.repliesFound = repliesCount;
        // store full response for debugging
        apiLogEntry.response = JSON.stringify(json);
        postInfo.apiLog = `OK: ${repliesCount}件のリプライ発見`;
        for (const rep of repliesFound) {
          const externalReplyId = String(rep.id || "");
          const text = rep.text || "";
          const username = rep.username || "";

        // Ownership check: compare reply's account identifier(s) to reservation.accountId only.
        // Use simple accountId match (username or id fields) and avoid expensive DB reads per reply.
        // Compare only by username (reservation.accountId holds the username)
        const replyOwnerMatch = !!(rep.username && String(rep.username) === String(acct.accountId));

        // If API says owned_by_me, only exclude when replyOwnerMatch is true.
        // If API says owned_by_me but owner doesn't match, log a single warning per account per run.
        if (rep.is_reply_owned_by_me === true) {
          if (replyOwnerMatch) {
            try { console.info(`[reply-fetch-exclude] account=${acct.accountId} replyId=${rep.id}`); } catch (e) { console.warn('[warn] reply-fetch-exclude log failed:', e); }
            continue;
          } else {
            // log mismatch only once per account per invocation to reduce log volume
            if (!((global as any).__replyFetchFlagMismatchLogged || {})[acct.accountId]) {
              try {
                console.warn(`[reply-fetch-flag-mismatch] account=${acct.accountId} replyId=${rep.id} username=${rep.username || null}`);
                (global as any).__replyFetchFlagMismatchLogged = (global as any).__replyFetchFlagMismatchLogged || {};
                (global as any).__replyFetchFlagMismatchLogged[acct.accountId] = true;
              } catch (e) { console.warn('[warn] reply-fetch-flag-mismatch log failed:', e); }
            }
            // fallthrough -> save
          }
        }

          const createdAt = nowSec();
          
            if (externalReplyId && text) {
            const ok = await upsertReplyItem(userId, acct, { 
              externalReplyId, 
              postId: replyApiId, // リプライ取得に使ったIDを保存
              text, 
              createdAt,
              originalPost: post
            });
            if (ok) saved++;
            // 詳細ログは必要に応じてコメントアウト
            // console.log(`[DEBUG] リプライ保存: ${externalReplyId} - @${username}: ${text.substring(0, 50)}`);
          }
        }
        
        apiLogs.push(apiLogEntry);
        break; // 成功したのでwhile ループを抜ける
        
      } catch (e) {
        console.error(`[ERROR] リクエスト例外 (試行${attempt + 1}): ${String(e).substring(0, 100)}`);
        
        // Address unavailable エラーまたは一時的エラーの場合はリトライ
        if (String(e).includes("Address unavailable") || String(e).includes("fetch")) {
          attempt++;
          if (attempt < maxRetries) {
            // debug output removed
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue; // while ループを続行
          }
        }
        
        postInfo.apiLog = `ERROR: ${String(e).substring(0, 50)}`;
        apiLogs.push({
          postId: post.postId,
          numericPostId: post.numericPostId,
          replyApiId: replyApiId,
          url: "",
          status: "ERROR",
          content: post.content.substring(0, 50),
          error: String(e).substring(0, 100)
        });
        break; // エラーで while ループを抜ける
      }
    } // while ループ終了
    
    postsInfo.push(postInfo);
  }

  return { 
    saved,
    postsFound: q.Items?.length || 0,
    postsWithPostId: (q.Items || []).filter(item => item.postId?.S).length,
    postsProcessed: (q.Items || []).length,
    postsInfo: postsInfo,
    apiLogs: apiLogs
  };
}

// Lambda関数の fetchIncomingReplies を移植（手動取得用に条件緩和）
async function fetchIncomingReplies(userId: string, acct: any) {
  const debugInfo = {
    accountId: acct.accountId,
    autoReply: acct.autoReply,
    hasAccessToken: !!acct.accessToken,
    hasProviderUserId: !!acct.providerUserId
  };
  
  // debug output removed
  
  // (manual warning removed) - handler now decides which accounts to process based on autoReply
  
  try {
    // Observability: log whether acct contains tokens/providerUserId so we can trace "token missing" cases
    try {
      console.info(`[reply-fetch-probe] account=${acct.accountId} hasAccessToken=${!!acct.accessToken} hasOauthAccessToken=${!!acct.oauthAccessToken} hasProviderUserId=${!!acct.providerUserId}`);
    } catch (e) { console.warn('[warn] reply-fetch-probe log failed:', e); }

    const r = await fetchThreadsRepliesAndSave({ acct, userId });
    // debug output removed
    return { 
      fetched: r.saved || 0,
      postsFound: r.postsFound || 0,
      postsWithPostId: r.postsWithPostId || 0,
      postsProcessed: r.postsProcessed || 0,
      postsInfo: r.postsInfo || [],
      apiLogs: r.apiLogs || []
    };
  } catch (e) {
    console.error(`[ERROR] アカウント ${acct.accountId} の返信取得失敗:`, e);
    return { fetched: 0, error: String(e) };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    // リクエストボディ (optional)
    const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
    const requestedAccountId = body?.accountId ? String(body.accountId) : null;
    const summaryOnly = !!body?.summaryOnly;

    // ユーザーのThreadsアカウントを取得
    let accounts = await fetchThreadsAccountsFull(userId);

    // single-account リクエストがあれば絞り込み（見つからなければ空配列で処理される）
    if (requestedAccountId) {
      const found = (accounts || []).find(a => a.accountId === requestedAccountId);
      accounts = found ? [found] : [];
    }

    // autoReply が有効なアカウントのみ処理対象とする
    const eligibleAccounts = (accounts || []).filter(a => !!a.autoReply);
    const skippedAccounts = (accounts || []).filter(a => !a.autoReply).map(a => a.accountId);

    if (skippedAccounts.length > 0) {
      console.info(`[reply-fetch-skip] skippedAccounts=${JSON.stringify(skippedAccounts)}`);
    }

    let totalFetched = 0;
    const results = [];

    for (const acct of eligibleAccounts) {
      const result = await fetchIncomingReplies(userId, acct);
      results.push({
        accountId: acct.accountId,
        displayName: acct.displayName,
        ...result
      });
      totalFetched += result.fetched || 0;
    }

    const debugSummary = {
      totalFetched,
      accountsProcessed: accounts.length,
      totalPostsFound: results.reduce((sum, r) => sum + (r.postsFound || 0), 0),
      totalPostsWithPostId: results.reduce((sum, r) => sum + (r.postsWithPostId || 0), 0),
      results: results.map(r => ({
        accountId: r.accountId,
        fetched: r.fetched,
        postsFound: r.postsFound || 0,
        postsWithPostId: r.postsWithPostId || 0,
        postsInfo: r.postsInfo || [],
        apiLogs: r.apiLogs || [],
        error: r.error || null
      }))
    };

    // debug output removed

    if (summaryOnly) {
      const summaryResults = results.map((r: any) => ({
        accountId: r.accountId,
        fetched: r.fetched || 0,
        error: r.error ? String(r.error).slice(0, 140) : null
      }));
      return res.status(200).json({
        ok: true,
        totalFetched,
        results: summaryResults,
        accounts: accounts.length,
        message: `${totalFetched}件のリプライを取得しました（${accounts.length}アカウント中）`
      });
    }

    return res.status(200).json({
      ok: true,
      totalFetched,
      results,
      accounts: accounts.length,
      debug: debugSummary,
      message: `${totalFetched}件のリプライを取得しました（${accounts.length}アカウント中）`
    });

  } catch (error) {
    console.error("fetch-replies API error:", error);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: String(error)
    });
  }
}

