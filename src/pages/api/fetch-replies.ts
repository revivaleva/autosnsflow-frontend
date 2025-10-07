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
async function upsertReplyItem(userId: string, acct: any, { externalReplyId, postId, text, createdAt, originalPost }: any) {
  const sk = `REPLY#${externalReplyId}`;

  // 既存チェック
  try {
    const existing = await ddb.send(new GetItemCommand({
      TableName: TBL_REPLIES,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: sk } },
    }));
    if (existing.Item) {
      return false; // 既に存在する
    }
  } catch (e) {
    // debug output removed
  }

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
  } catch {
    return false;
  }
}

// 簡易的なログ出力（Lambda の putLog と同等の最小実装）
async function putLog({
  userId = "", type, accountId = "", targetId = "", status = "info", message = "", detail = {}
}: any) {
  try {
    const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
    const uid = userId || "unknown";
    const shouldPersist = (status === 'error' && uid !== "unknown") || allowDebug;
    if (!shouldPersist) {
      // debug output removed
      return;
    }

    const item = {
      PK: { S: `USER#${uid}` },
      SK: { S: `LOG#${Date.now()}#${Math.random().toString(36).slice(2,10)}` },
      type: { S: type || "system" },
      accountId: { S: accountId || "" },
      targetId: { S: targetId || "" },
      status: { S: status || "info" },
      message: { S: String(message || "") },
      detail: { S: JSON.stringify(detail || {}) },
      createdAt: { N: String(nowSec()) },
    };
    await ddb.send(new PutItemCommand({ TableName: TBL_LOGS, Item: item }));
  } catch (e) {
    console.warn("[warn] putLog skipped (fetch-replies):", String((e as Error)?.message || e));
  }
}

// Lambda関数の fetchThreadsRepliesAndSave を移植
async function fetchThreadsRepliesAndSave({ acct, userId, lookbackSec = 24*3600 }: any) {
  // debug output removed
  
  if (!acct?.accessToken) throw new Error("Threads のトークン不足");
  if (!acct?.providerUserId) throw new Error("Threads のユーザーID取得失敗");
  
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

    // リプライ取得用のIDを決定（数字ID優先）
    const isNumericPostId = post.numericPostId && /^\d+$/.test(post.numericPostId);
    const isNumericMainPostId = post.postId && /^\d+$/.test(post.postId);
    
    let replyApiId: string;
    if (isNumericPostId) {
      replyApiId = post.numericPostId;
    } else if (isNumericMainPostId) {
      replyApiId = post.postId;
    } else {
      replyApiId = post.numericPostId || post.postId;
    }

    // debug output removed

    const postInfo: any = {
      postId: post.postId || "空",
      numericPostId: post.numericPostId || "空",
      replyApiId: replyApiId || "空",
      content: (post.content || "").substring(0, 100),
      postedAt: post.postedAt || "空",
      hasReplyApiId: !!replyApiId,
      apiLog: ""
    };

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
        let url = `https://graph.threads.net/v1.0/${encodeURIComponent(replyApiId)}/replies?fields=id,text,username,permalink,is_reply_owned_by_me&access_token=${encodeURIComponent(acct.accessToken)}`;
        
        // debug output removed
        
        let r = await fetch(url);
        
        // 方法1が失敗した場合、conversation エンドポイントを試行
        if (!r.ok && attempt === 0) {
          // debug output removed
          url = `https://graph.threads.net/v1.0/${encodeURIComponent(replyApiId)}/conversation?fields=id,text,username,permalink,is_reply_owned_by_me&access_token=${encodeURIComponent(acct.accessToken)}`;
          r = await fetch(url);
          // 代替IDがある場合は再試行
          if (!r.ok && post.numericPostId && post.postId && post.numericPostId !== post.postId) {
            const alternativeId = post.numericPostId === replyApiId ? post.postId : post.numericPostId;
            // debug output removed
            url = `https://graph.threads.net/v1.0/${encodeURIComponent(alternativeId)}/replies?fields=id,text,username,permalink&access_token=${encodeURIComponent(acct.accessToken)}`;
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

          // 優先: APIが返すis_reply_owned_by_meを使って除外
          if (rep.is_reply_owned_by_me === true) {
            try {
              await putLog({
                userId,
                type: "reply-fetch-exclude",
                accountId: acct.accountId,
                status: "info",
                message: "is_reply_owned_by_me=true のため除外",
                detail: { replyId: rep.id, reason: 'is_reply_owned_by_me' }
              });
            } catch (e) { console.warn('[warn] putLog failed for is_reply flag exclude:', e); }
            continue;
          }

          // フラグが付いていない場合は除外しないが、フィールド名や値の差異を調査するためログを出力する
          try {
            const authorCandidates = [
              rep.from?.id,
              rep.from?.username,
              rep.username,
              rep.user?.id,
              rep.user?.username,
              rep.author?.id,
              rep.author?.username,
            ].map(x => (x == null ? "" : String(x)));

            const s2 = (acct.secondStageContent || "").trim();
            const rt = (rep.text || "").trim();

            // putLogでデバッグ情報を残す（除外はしない）
            const debugDetail: any = { replyId: rep.id, authorCandidates, providerUserId: acct.providerUserId };
            if (s2 && rt) debugDetail.secondStageSample = { s2: s2.replace(/\s+/g,' ').toLowerCase(), rt: rt.replace(/\s+/g,' ').toLowerCase() };

            // only log when there's a potential match to investigate
            const potentialMatch = authorCandidates.some(a => a && acct.providerUserId && a === acct.providerUserId) || (s2 && rt && (s2.replace(/\s+/g,' ').toLowerCase() === rt.replace(/\s+/g,' ').toLowerCase()));
            if (potentialMatch) {
              await putLog({ userId, type: "reply-fetch-flag-mismatch", accountId: acct.accountId, status: "info", message: "flag missing but candidate fields matched", detail: debugDetail });
            }
          } catch (e) {
            console.warn('[warn] flag-mismatch logging failed:', e);
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
  
  // 手動取得の場合はautoReplyの条件を緩和（警告のみ）
  if (!acct.autoReply) {
    console.warn(`[WARNING] アカウント ${acct.accountId} はautoReplyがOFFですが手動取得を実行します`);
  }
  
  try {
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

    // ユーザーのThreadsアカウントを取得
    const accounts = await fetchThreadsAccountsFull(userId);
    
    let totalFetched = 0;
    const results = [];

    for (const acct of accounts) {
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

