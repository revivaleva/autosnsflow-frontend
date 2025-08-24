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
    console.log(`[DEBUG] 既存チェック失敗、新規作成を試行: ${String(e).substring(0, 100)}`);
  }

  // AI生成による返信内容の作成
  let responseContent = "";
  
  // 手動取得でもautoReplyが有効な場合は返信内容を生成
  if (acct.autoReply) {
    try {
      console.log(`[DEBUG] アカウント ${acct.accountId} の返信内容を生成中...`);
      
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
          console.log(`[DEBUG] AI生成成功: ${responseContent.substring(0, 50)}...`);
        }
      } else {
        console.log(`[WARN] AI生成失敗: ${aiResponse.status} ${aiResponse.statusText}`);
      }
    } catch (e) {
      console.log(`[WARN] 返信コンテンツ生成失敗: ${String(e).substring(0, 100)}`);
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

// Lambda関数の fetchThreadsRepliesAndSave を移植
async function fetchThreadsRepliesAndSave({ acct, userId, lookbackSec = 24*3600 }: any) {
  console.log(`[INFO] ${acct.accountId} のリプライ取得開始`);
  
  if (!acct?.accessToken) throw new Error("Threads のトークン不足");
  if (!acct?.providerUserId) throw new Error("Threads のユーザーID取得失敗");
  
  const since = nowSec() - lookbackSec;
  let saved = 0;
  
  console.log(`[INFO] 検索条件: ${lookbackSec}秒前以降の投稿`);

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
  
  console.log(`[INFO] DynamoDB検索結果: ${q.Items?.length || 0}件の投稿済み記事を発見`);
  
  if (!q.Items || q.Items.length === 0) {
    console.log(`[INFO] 対象となる投稿が見つからないため処理を終了`);
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
      console.log(`[DEBUG] numericPostIdを使用: ${replyApiId}`);
    } else if (isNumericMainPostId) {
      replyApiId = post.postId;
      console.log(`[DEBUG] 数字のpostIdを使用: ${replyApiId}`);
    } else {
      replyApiId = post.numericPostId || post.postId;
      console.log(`[DEBUG] フォールバック使用: ${replyApiId}`);
    }

    // 詳細なID分析
    console.log(`[DEBUG] ID分析 - SK: ${item.SK?.S}`);
    console.log(`[DEBUG] - postId: "${post.postId}" (長さ: ${post.postId?.length || 0})`);
    console.log(`[DEBUG] - numericPostId: "${post.numericPostId}" (長さ: ${post.numericPostId?.length || 0})`);
    console.log(`[DEBUG] - replyApiId選択: "${replyApiId}" (numericPostId優先: ${!!post.numericPostId})`);
    console.log(`[DEBUG] - postId数字判定: ${post.postId ? /^\d+$/.test(post.postId) : false}`);
    console.log(`[DEBUG] - numericPostId数字判定: ${post.numericPostId ? /^\d+$/.test(post.numericPostId) : false}`);

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
        
        console.log(`[INFO] リプライ取得開始: ${replyApiId} (試行${attempt + 1}/${maxRetries})`);
        console.log(`[DEBUG] 完全なURL: ${url.replace(acct.accessToken, "***TOKEN***")}`);
        console.log(`[DEBUG] エンコード前ID: "${replyApiId}"`);
        console.log(`[DEBUG] エンコード後ID: "${encodeURIComponent(replyApiId)}"`);
        
        let r = await fetch(url);
        
        // 方法1が失敗した場合、conversation エンドポイントを試行
        if (!r.ok && attempt === 0) {
          console.log(`[INFO] repliesエンドポイント失敗 (${r.status}), conversationで再試行`);
          url = `https://graph.threads.net/v1.0/${encodeURIComponent(replyApiId)}/conversation?fields=id,text,username,permalink,is_reply_owned_by_me&access_token=${encodeURIComponent(acct.accessToken)}`;
          r = await fetch(url);
          // 代替IDがある場合は再試行
          if (!r.ok && post.numericPostId && post.postId && post.numericPostId !== post.postId) {
            const alternativeId = post.numericPostId === replyApiId ? post.postId : post.numericPostId;
            console.log(`[INFO] conversation失敗 (${r.status}), 代替ID "${alternativeId}" でreplies再試行`);
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
          console.log(`[ERROR] API失敗 (試行${attempt + 1}): ${r.status} ${r.statusText} - ${errorText.substring(0, 100)}`);
          if (errorText.includes("Address unavailable") || r.status >= 500) {
            attempt++;
            if (attempt < maxRetries) {
              console.log(`[INFO] リトライ実行、${3000}ms後に再試行`);
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
        console.log(`[INFO] ${replyApiId}: ${repliesFound.length}件のリプライ取得成功`);
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
            console.log(`[DEBUG] 自分のリプライを除外 (is_reply_owned_by_me): ${externalReplyId}`);
            continue;
          }

          // フォールバック: 投稿者フィールドで除外
          const authorId = rep.from?.id ?? rep.from?.username ?? rep.user?.id ?? rep.user?.username ?? rep.author?.id ?? rep.author?.username ?? "";
          if (authorId && acct.providerUserId && authorId === acct.providerUserId) {
            console.log(`[DEBUG] 自分のリプライを除外 (author match): ${externalReplyId}`);
            continue;
          }

          // フォールバック2: 二段階投稿の本文と一致する場合は除外
          try {
            const s2 = (acct.secondStageContent || "").trim();
            const rt = (rep.text || "").trim();
            if (s2 && rt) {
              const s2n = s2.replace(/\s+/g, ' ').toLowerCase();
              const rtn = rt.replace(/\s+/g, ' ').toLowerCase();
              if (s2n === rtn || s2n.includes(rtn) || rtn.includes(s2n)) {
                console.log(`[DEBUG] 二段階投稿の本文と一致するため除外: reply=${externalReplyId}`);
                continue;
              }
            }
          } catch (e) {
            console.log("[warn] secondStage exclusion check failed:", e);
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
        console.log(`[ERROR] リクエスト例外 (試行${attempt + 1}): ${String(e).substring(0, 100)}`);
        
        // Address unavailable エラーまたは一時的エラーの場合はリトライ
        if (String(e).includes("Address unavailable") || String(e).includes("fetch")) {
          attempt++;
          if (attempt < maxRetries) {
            console.log(`[INFO] 例外リトライ、${3000}ms後に再試行`);
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
  
  console.log(`[DEBUG] アカウント ${acct.accountId} のリプライ取得開始`, debugInfo);
  
  // 手動取得の場合はautoReplyの条件を緩和（警告のみ）
  if (!acct.autoReply) {
    console.log(`[WARNING] アカウント ${acct.accountId} はautoReplyがOFFですが手動取得を実行します`);
  }
  
  try {
    const r = await fetchThreadsRepliesAndSave({ acct, userId });
    console.log(`[DEBUG] アカウント ${acct.accountId} の取得結果: ${r.saved}件 (投稿${r.postsFound}件中、postId有り${r.postsWithPostId}件)`);
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

    console.log(`[DEBUG] 処理完了:`, debugSummary);

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

