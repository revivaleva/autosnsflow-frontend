// /src/pages/api/migrate-post-ids.ts
// 一時的なデータ修正API：postIdとnumericPostIdの整理

import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { getThreadsPermalink } from "@/lib/threads";

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";
const TBL_THREADS = process.env.TBL_THREADS || "ThreadsAccounts";

// 文字列が数字のみかどうかを判定
function isNumericOnly(str: string): boolean {
  return /^\d+$/.test(str);
}

// 投稿の詳細情報から文字列IDを取得
async function getStringPostId(accessToken: string, numericId: string): Promise<string | null> {
  try {
    const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
    const url = `${base}/${encodeURIComponent(numericId)}?fields=id&access_token=${encodeURIComponent(accessToken)}`;
    
    const r = await fetch(url);
    if (!r.ok) {
      console.log(`[MIGRATE] 投稿詳細取得失敗: ${r.status} for ID ${numericId}`);
      return null;
    }
    
    const json = await r.json();
    return json?.id || null;
  } catch (e) {
    console.log(`[MIGRATE] 投稿詳細取得エラー: ${e} for ID ${numericId}`);
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    console.log(`[MIGRATE] ユーザー ${userId} のデータ修正開始`);

    // 投稿済みの予約投稿を取得
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk",
      FilterExpression: "#st = :posted",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":posted": { S: "posted" },
      },
    }));

    const results = {
      total: q.Items?.length || 0,
      processed: 0,
      migrated: 0,
      skipped: 0,
      errors: 0,
      details: [] as any[]
    };

    console.log(`[MIGRATE] ${results.total}件の投稿済み予約投稿を発見`);

    // 各アカウントのアクセストークンを取得
    const accountTokens: Record<string, string> = {};
    
    for (const item of (q.Items || [])) {
      const accountId = item.accountId?.S || "";
      if (!accountId || accountTokens[accountId]) continue;
      
      try {
        const acct = await ddb.send(new QueryCommand({
          TableName: TBL_THREADS,
          KeyConditionExpression: "PK = :pk AND SK = :sk",
          ExpressionAttributeValues: {
            ":pk": { S: `USER#${userId}` },
            ":sk": { S: `ACCOUNT#${accountId}` },
          },
          ProjectionExpression: "accessToken",
        }));
        
        const accessToken = acct.Items?.[0]?.accessToken?.S || "";
        if (accessToken) {
          accountTokens[accountId] = accessToken;
        }
      } catch (e) {
        console.log(`[MIGRATE] アカウント ${accountId} のトークン取得失敗: ${e}`);
      }
    }

    for (const item of (q.Items || [])) {
      results.processed++;
      
      const pk = item.PK?.S || "";
      const sk = item.SK?.S || "";
      const currentPostId = item.postId?.S || "";
      const currentNumericPostId = item.numericPostId?.S || "";
      const accountId = item.accountId?.S || "";
      
      const detail = {
        sk,
        accountId,
        currentPostId,
        currentNumericPostId,
        action: "none",
        newPostId: "",
        newNumericPostId: "",
        error: ""
      };

      try {
        // postIdが数字のみの場合は修正が必要
        if (currentPostId && isNumericOnly(currentPostId)) {
          console.log(`[MIGRATE] 修正対象: ${sk} - postId=${currentPostId}`);
          
          const accessToken = accountTokens[accountId];
          if (!accessToken) {
            detail.error = "アクセストークンなし";
            detail.action = "error";
            results.errors++;
            results.details.push(detail);
            continue;
          }
          
          // 文字列IDを取得
          const stringId = await getStringPostId(accessToken, currentPostId);
          if (!stringId) {
            detail.error = "文字列ID取得失敗";
            detail.action = "error";
            results.errors++;
            results.details.push(detail);
            continue;
          }
          
          // 新しいpostURLを生成
          const permalink = await getThreadsPermalink({ accessToken, postId: stringId });
          const newPostUrl = permalink?.url || "";
          
          // データベース更新
          const updateExpression = [
            "SET postId = :stringId",
            "numericPostId = :numericId"
          ];
          const updateValues: any = {
            ":stringId": { S: stringId },
            ":numericId": { S: currentPostId },
          };
          
          // postUrlも更新（削除して再生成）
          if (newPostUrl) {
            updateExpression.push("postUrl = :newUrl");
            updateValues[":newUrl"] = { S: newPostUrl };
          } else {
            updateExpression.push("REMOVE postUrl");
          }
          
          await ddb.send(new UpdateItemCommand({
            TableName: TBL_SCHEDULED,
            Key: { PK: { S: pk }, SK: { S: sk } },
            UpdateExpression: updateExpression.join(", "),
            ExpressionAttributeValues: updateValues,
          }));
          
          detail.action = "migrated";
          detail.newPostId = stringId;
          detail.newNumericPostId = currentPostId;
          results.migrated++;
          
          console.log(`[MIGRATE] 完了: ${sk} - ${currentPostId} → postId=${stringId}, numericPostId=${currentPostId}`);
          
        } else {
          detail.action = "skipped";
          results.skipped++;
          console.log(`[MIGRATE] スキップ: ${sk} - postId=${currentPostId} (数字以外またはnumericPostId既存)`);
        }
        
        results.details.push(detail);
        
      } catch (e) {
        detail.error = String(e);
        detail.action = "error";
        results.errors++;
        results.details.push(detail);
        console.error(`[MIGRATE] エラー: ${sk} - ${e}`);
      }
    }

    console.log(`[MIGRATE] 完了: ${results.migrated}件移行, ${results.skipped}件スキップ, ${results.errors}件エラー`);

    return res.status(200).json({
      ok: true,
      message: `データ修正完了: ${results.migrated}件移行, ${results.skipped}件スキップ, ${results.errors}件エラー`,
      results
    });

  } catch (error) {
    console.error("[MIGRATE] エラー:", error);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: String(error)
    });
  }
}
