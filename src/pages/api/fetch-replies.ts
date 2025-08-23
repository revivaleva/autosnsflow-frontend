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

  for (const item of (q.Items || [])) {
    const post = {
      postId: item.postId?.S || "",
      content: item.content?.S || "",
      postedAt: Number(item.postedAt?.N || "0"),
      scheduledPostId: item.scheduledPostId?.S || "",
    };

    if (!post.postId) {
      console.log(`[WARNING] 投稿 ${post.scheduledPostId} のpostIdが空です:`, post);
      continue;
    }
    
    console.log(`[DEBUG] 投稿 ${post.postId} のリプライ取得を開始... 本文: "${post.content.substring(0, 50)}"`);

    // Threads APIでリプライを取得
    try {
      const url = `https://graph.threads.net/v1.0/${encodeURIComponent(post.postId)}/replies?fields=id,text&access_token=${encodeURIComponent(acct.accessToken)}`;
      console.log(`[DEBUG] Threads API URL: ${url.replace(acct.accessToken, "***TOKEN***")}`);
      
      const r = await fetch(url);
      console.log(`[DEBUG] Threads API レスポンス: ${r.status} ${r.statusText}`);
      
      if (!r.ok) { 
        const errorText = await r.text();
        console.error(`[ERROR] Threads replies API失敗: ${r.status} - ${errorText}`);
        continue; 
      }
      
      const json = await r.json();
      console.log(`[DEBUG] Threads API レスポンス内容:`, json);
      console.log(`[DEBUG] リプライ数: ${json?.data?.length || 0}件`);
      
      for (const rep of (json?.data || [])) {
        const externalReplyId = String(rep.id);
        const text = rep.text || "";
        const createdAt = nowSec();
        console.log(`[DEBUG] リプライ保存: ${externalReplyId} - "${text.substring(0, 30)}"`);
        
        const ok = await upsertReplyItem(userId, acct, { 
          externalReplyId, 
          postId: post.postId, 
          text, 
          createdAt,
          originalPost: post
        });
        if (ok) {
          saved++;
          console.log(`[DEBUG] リプライ保存成功: ${externalReplyId}`);
        } else {
          console.log(`[DEBUG] リプライ保存失敗: ${externalReplyId}`);
        }
      }
    } catch (e) {
      console.error(`[ERROR] リプライ取得エラー (postId: ${post.postId}):`, e);
    }
  }
  
  const postsInfo = (q.Items || []).map(item => ({
    postId: item.postId?.S || "空",
    content: (item.content?.S || "").substring(0, 100),
    postedAt: item.postedAt?.N || "空",
    hasPostId: !!(item.postId?.S)
  }));

  return { 
    saved,
    postsFound: q.Items?.length || 0,
    postsWithPostId: (q.Items || []).filter(item => item.postId?.S).length,
    postsProcessed: (q.Items || []).length,
    postsInfo: postsInfo
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
      postsInfo: r.postsInfo || []
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
