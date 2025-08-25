// /src/pages/api/debug/threads-api-test.ts
// Threads API直接テスト（実際の投稿なし）
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_THREADS = "ThreadsAccounts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { scheduledPostId, testMode = "dryrun" } = req.body || {};
    
    if (!scheduledPostId) {
      return res.status(400).json({ error: "scheduledPostId is required" });
    }

    // 予約投稿情報を取得
    const scheduledPost = await ddb.send(new GetItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `SCHEDULEDPOST#${scheduledPostId}` }
      },
    }));

    if (!scheduledPost.Item) {
      return res.status(404).json({ error: "Scheduled post not found" });
    }

    const accountId = scheduledPost.Item.accountId?.S;
    const postId = scheduledPost.Item.postId?.S;
    const numericPostId = scheduledPost.Item.numericPostId?.S;

    // アカウント情報を取得
    const accountItem = await ddb.send(new GetItemCommand({
      TableName: TBL_THREADS,
      Key: { 
        PK: { S: `USER#${userId}` }, 
        SK: { S: `ACCOUNT#${accountId}` }
      },
      ProjectionExpression: "accessToken, providerUserId, secondStageContent",
    }));

    if (!accountItem.Item) {
      return res.status(404).json({ error: "Account not found" });
    }

    const accessToken = accountItem.Item.accessToken?.S;
    const providerUserId = accountItem.Item.providerUserId?.S;
    const secondStageContent = accountItem.Item.secondStageContent?.S;

    // 推奨されるpostIDを決定
    const targetPostId = postId || numericPostId;

    // Threads API テスト用のペイロード構築
    const threadsEndpoint = `https://graph.threads.net/v1.0/${encodeURIComponent(providerUserId || '')}/threads`;
    
    const testPayloads = [
      {
        name: "現在の実装（replied_to_id）",
        endpoint: threadsEndpoint,
        payload: {
          media_type: "TEXT",
          text: secondStageContent || "テスト投稿",
          replied_to_id: targetPostId,
          access_token: "***HIDDEN***"
        },
        actualPayload: {
          media_type: "TEXT",
          text: secondStageContent || "テスト投稿",
          replied_to_id: targetPostId,
          access_token: accessToken
        }
      },
      {
        name: "代替実装1（reply_to_id）",
        endpoint: threadsEndpoint,
        payload: {
          media_type: "TEXT",
          text: secondStageContent || "テスト投稿",
          reply_to_id: targetPostId,
          access_token: "***HIDDEN***"
        },
        actualPayload: {
          media_type: "TEXT",
          text: secondStageContent || "テスト投稿",
          reply_to_id: targetPostId,
          access_token: accessToken
        }
      },
      {
        name: "代替実装2（in_reply_to）",
        endpoint: threadsEndpoint,
        payload: {
          media_type: "TEXT",
          text: secondStageContent || "テスト投稿",
          in_reply_to: targetPostId,
          access_token: "***HIDDEN***"
        },
        actualPayload: {
          media_type: "TEXT",
          text: secondStageContent || "テスト投稿",
          in_reply_to: targetPostId,
          access_token: accessToken
        }
      }
    ];

    let testResults = [];

    if (testMode === "live" && accessToken && providerUserId) {
      // 実際のAPI呼び出しテスト（create のみ、publish しない）
      for (const test of testPayloads) {
        try {
          console.log(`[TEST] ${test.name}: ${JSON.stringify(test.payload)}`);
          
          const response = await fetch(test.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(test.actualPayload),
          });
          
          const responseText = await response.text();
          let responseJson = {};
          try {
            responseJson = JSON.parse(responseText);
          } catch (e) {
            responseJson = { rawText: responseText };
          }
          
          testResults.push({
            test: test.name,
            status: response.status,
            ok: response.ok,
            response: responseJson,
            error: !response.ok ? responseText : null,
          });
          
          // 成功した場合は1つだけテストして終了
          if (response.ok) {
            console.log(`[SUCCESS] ${test.name} が成功しました`);
            break;
          }
          
        } catch (error) {
          testResults.push({
            test: test.name,
            status: "EXCEPTION",
            ok: false,
            error: String(error),
          });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      mode: testMode,
      debugInfo: {
        scheduledPostId,
        accountId,
        targetPostId,
        providerUserId,
        hasAccessToken: !!accessToken,
        hasSecondStageContent: !!secondStageContent,
        secondStageContentLength: secondStageContent?.length || 0,
      },
      testPayloads: testPayloads.map(t => ({
        name: t.name,
        endpoint: t.endpoint,
        payload: t.payload
      })),
      testResults: testMode === "live" ? testResults : [],
      recommendations: [
        "1. 'replied_to_id' が標準的なパラメータ名",
        "2. postId/numericPostIdの値を確認",
        "3. accessTokenとproviderUserIdの有効性確認",
        "4. Threads APIのエンドポイントが正しいか確認"
      ]
    });

  } catch (e: any) {
    console.error("threads-api-test error:", e);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: e?.message || "Unknown error"
    });
  }
}
