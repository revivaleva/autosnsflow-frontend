// /src/pages/api/fetch-replies.ts
// 手動でリプライを取得するAPI（Lambda関数の処理を移植）

import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { fetchThreadsAccountsFull } from "@autosnsflow/backend-core";

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";
const TBL_REPLIES = process.env.TBL_REPLIES || "Replies";

// 現在時刻（Unix秒）
const nowSec = () => Math.floor(Date.now() / 1000);

// Lambda関数の upsertReplyItem を移植
async function upsertReplyItem(userId: string, acct: any, { externalReplyId, postId, text, createdAt, originalPost }: any) {
  const sk = `REPLY#${externalReplyId}`;

  // AI生成返信（簡易版）
  let responseContent = "";
  try {
    const prompt = `以下のリプライに簡潔に返信してください（100文字以内）：\n${text}`;
    // 実際のAI生成はここで実装（今回は仮）
    responseContent = `${text}への返信です。ありがとうございます！`;
  } catch (e) {
    console.error("AI生成失敗:", e);
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
  console.log(`[DEBUG] ${acct.accountId} のリプライ取得詳細開始`);
  console.log(`[DEBUG] アカウント詳細:`, {
    accountId: acct.accountId,
    hasAccessToken: !!acct.accessToken,
    hasProviderUserId: !!acct.providerUserId,
    accessTokenLength: acct.accessToken?.length || 0,
    providerUserId: acct.providerUserId || "空"
  });
  
  if (!acct?.accessToken) throw new Error("Threads のトークン不足");
  if (!acct?.providerUserId) throw new Error("Threads のユーザーID取得失敗");
  
  const since = nowSec() - lookbackSec;
  let saved = 0;
  
  console.log(`[DEBUG] 検索条件: ${lookbackSec}秒前以降の投稿 (${new Date(since * 1000).toISOString()})`);

  // 投稿済みの予約投稿を取得
  console.log(`[DEBUG] DynamoDB検索条件: PK=USER#${userId}, status=posted, postedAt>=${since}, accountId=${acct.accountId}`);
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
    ProjectionExpression: "postId, content, postedAt, scheduledPostId",
  }));
  
  console.log(`[DEBUG] DynamoDB検索結果: ${q.Items?.length || 0}件の投稿済み記事を発見`);
  if (q.Items && q.Items.length > 0) {
    console.log(`[DEBUG] 最初の投稿済み記事:`, {
      postId: q.Items[0].postId?.S || "空",
      numericPostId: q.Items[0].numericPostId?.S || "空", 
      postedAt: q.Items[0].postedAt?.N || "空",
      content: (q.Items[0].content?.S || "").substring(0, 50),
      SK: q.Items[0].SK?.S || "空"
    });
    
    // 全投稿のpostId状況を確認
    const postIdStatus = q.Items.map(item => ({
      SK: (item.SK?.S || "").substring(0, 20) + "...",
      postId: item.postId?.S || "空",
      numericPostId: item.numericPostId?.S || "空",
      postedAt: item.postedAt?.N || "空"
    }));
    console.log(`[DEBUG] 全投稿のpostID状況:`, postIdStatus);
  } else {
    // 投稿が見つからない場合の調査
    console.log(`[DEBUG] 投稿が見つからない原因調査:`);
    console.log(`[DEBUG] - ユーザー: ${userId}`);
    console.log(`[DEBUG] - アカウント: ${acct.accountId}`);
    console.log(`[DEBUG] - 検索開始時刻: ${since} (${new Date(since * 1000).toISOString()})`);
    console.log(`[DEBUG] - 現在時刻: ${nowSec()} (${new Date(nowSec() * 1000).toISOString()})`);
  }

  // 上記でまとめて処理済み
  
  const postsInfo = [];
  const apiLogs = [];

  for (const item of (q.Items || [])) {
    const post = {
      postId: item.postId?.S || "",
      content: item.content?.S || "",
      postedAt: Number(item.postedAt?.N || "0"),
      scheduledPostId: item.scheduledPostId?.S || "",
    };

    const postInfo: any = {
      postId: post.postId || "空",
      content: (post.content || "").substring(0, 100),
      postedAt: post.postedAt || "空",
      hasPostId: !!(post.postId),
      apiLog: ""
    };

    if (!post.postId) {
      postInfo.apiLog = "SKIP: postId無し";
      postsInfo.push(postInfo);
      continue;
    }

    // Threads APIでリプライを取得 - 代替アプローチを試行
    try {
      // 方法1: 投稿の詳細情報を取得（replies情報が含まれる可能性）
      let url = `https://graph.threads.net/v1.0/${encodeURIComponent(post.postId)}?fields=id,text,replies,children&access_token=${encodeURIComponent(acct.accessToken)}`;
      
      console.log(`[DEBUG] Threads API リクエスト開始 (投稿詳細):`);
      console.log(`[DEBUG] - postId: ${post.postId}`);
      console.log(`[DEBUG] - URL: ${url.replace(acct.accessToken, "***TOKEN***")}`);
      console.log(`[DEBUG] - アクセストークン長: ${acct.accessToken?.length || 0}`);
      
      let r = await fetch(url);
      
      // 方法1が失敗した場合、方法2を試行: me/threadsから特定投稿を検索
      if (!r.ok) {
        console.log(`[DEBUG] 方法1失敗 (${r.status}), 方法2を試行: me/threads`);
        url = `https://graph.threads.net/v1.0/me/threads?fields=id,text,replies,children&access_token=${encodeURIComponent(acct.accessToken)}`;
        r = await fetch(url);
      }
      
      const apiLogEntry: {
        postId: string;
        url: string;
        status: string;
        content: string;
        error?: string;
        repliesFound?: number;
        response?: string;
      } = {
        postId: post.postId,
        url: url.replace(acct.accessToken, "***TOKEN***"),
        status: `${r.status} ${r.statusText}`,
        content: post.content.substring(0, 50)
      };
      
      if (!r.ok) { 
        const errorText = await r.text();
        console.log(`[DEBUG] Threads API エラー詳細:`);
        console.log(`[DEBUG] - ステータス: ${r.status} ${r.statusText}`);
        console.log(`[DEBUG] - レスポンス: ${errorText}`);
        console.log(`[DEBUG] - ヘッダー: ${JSON.stringify(Object.fromEntries(r.headers.entries()))}`);
        
        apiLogEntry.error = `${r.status} - ${errorText.substring(0, 100)}`;
        postInfo.apiLog = `ERROR: 全手法失敗 ${r.status} ${errorText.substring(0, 50)}`;
        apiLogs.push(apiLogEntry);
        postsInfo.push(postInfo);
        continue; 
      }
      
      const json = await r.json();
      console.log(`[DEBUG] Threads API 成功レスポンス:`, JSON.stringify(json).substring(0, 300));
      
      let repliesFound = [];
      
      // レスポンスからリプライ情報を抽出
      if (url.includes('/me/threads')) {
        // me/threadsの場合: 該当postIdを検索してからreplies情報を取得
        const posts = json?.data || [];
        const targetPost = posts.find((p: any) => p.id === post.postId);
        if (targetPost) {
          repliesFound = targetPost.replies?.data || targetPost.children?.data || [];
          console.log(`[DEBUG] me/threadsから対象投稿発見: ${repliesFound.length}件のリプライ`);
        } else {
          console.log(`[DEBUG] me/threadsに対象投稿 ${post.postId} が見つからない`);
        }
      } else {
        // 直接投稿詳細の場合
        repliesFound = json?.replies?.data || json?.children?.data || json?.data || [];
        console.log(`[DEBUG] 投稿詳細から ${repliesFound.length}件のリプライ取得`);
      }
      
      const repliesCount = repliesFound.length;
      apiLogEntry.repliesFound = repliesCount;
      apiLogEntry.response = JSON.stringify(json).substring(0, 200);
      
      postInfo.apiLog = `OK: ${repliesCount}件のリプライ発見`;
      
      for (const rep of repliesFound) {
        const externalReplyId = String(rep.id || rep.reply_id || "");
        const text = rep.text || rep.message || "";
        const createdAt = nowSec();
        
        if (externalReplyId && text) {
          const ok = await upsertReplyItem(userId, acct, { 
            externalReplyId, 
            postId: post.postId, 
            text, 
            createdAt,
            originalPost: post
          });
          if (ok) saved++;
          console.log(`[DEBUG] リプライ保存: ${externalReplyId} - ${text.substring(0, 50)}`);
        } else {
          console.log(`[DEBUG] 不完全なリプライデータ: id=${externalReplyId}, text=${text.substring(0, 20)}`);
        }
      }
      
      apiLogs.push(apiLogEntry);
    } catch (e) {
      postInfo.apiLog = `ERROR: ${String(e).substring(0, 50)}`;
      apiLogs.push({
        postId: post.postId,
        url: "",
        status: "ERROR",
        content: post.content.substring(0, 50),
        error: String(e).substring(0, 100)
      });
    }
    
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
