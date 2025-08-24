// /src/pages/api/replies.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
// [ADD] サーバ専用ユーティリティを使用（フロントからは import しない）
import { createDynamoClient } from "@/lib/ddb";            // [ADD]
import { verifyUserFromRequest } from "@/lib/auth";        // [ADD]

// [ADD] 共有クライアント（固定キーがあれば使用／無ければ実行ロール）
const ddb = createDynamoClient();                          // [ADD]
// [ADD] テーブル名を環境変数化（未設定は既定名）
const TBL_REPLIES = process.env.TBL_REPLIES || "Replies";  // [ADD]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // [ADD] 認証（Cookie or Bearer の IdToken を検証して sub を取得）
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { Items } = await ddb.send(new QueryCommand({
      TableName: TBL_REPLIES,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` } },
      ScanIndexForward: false,
      Limit: 200,
    }));

    return res.status(200).json({
      replies: (Items ?? []).map((i: any) => ({
        id: i.SK?.S || "",
        postId: i.postId?.S ?? "",
        accountId: i.accountId?.S ?? "",
        scheduledAt: i.originalPostedAt?.N ? Number(i.originalPostedAt.N) : 0,
        content: i.originalContent?.S ?? "",
        incomingReply: i.incomingReply?.S ?? "",
        replyContent: i.replyContent?.S ?? "",
        responseContent: i.responseContent?.S ?? "",
        replyAt: i.replyAt?.N ? Number(i.replyAt.N) : null,
        status: i.status?.S ?? "",
        createdAt: i.createdAt?.N ? Number(i.createdAt.N) : null,
      })),
    });
  } catch (e: any) {
    // [MOD] 認証失敗/内部エラーを区別
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
