// /src/pages/api/replies.ts
// [MOD] decodeのみ→検証へ統一、DynamoDBクライアントを共通化
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";             // [ADD]
import { verifyUserFromRequest } from "@/lib/auth";         // [ADD]

const ddb = createDynamoClient();                           // [ADD]
const TBL = process.env.TBL_REPLIES || "Replies";           // [ADD] 環境変数化（既定: Replies）

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req);          // [ADD] Cognito検証
    const userId = user.sub;                                // [ADD]

    const { Items } = await ddb.send(new QueryCommand({
      TableName: TBL,
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
        scheduledAt: i.scheduledAt?.N ? Number(i.scheduledAt.N) : 0,
        content: i.content?.S ?? "",
        replyContent: i.replyContent?.S ?? "",
        responseContent: i.responseContent?.S ?? "",
        replyAt: i.replyAt?.N ? Number(i.replyAt.N) : null,
        status: i.status?.S ?? "",
        createdAt: i.createdAt?.N ? Number(i.createdAt.N) : null,
      })),
    });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500); // [ADD]
    return res.status(code).json({ error: e?.message || String(e) });          // [MOD]
  }
}
