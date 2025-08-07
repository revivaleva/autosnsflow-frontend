// /src/pages/api/replies.ts
import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  QueryCommand
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "ap-northeast-1" });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const userId = (req.query.userId as string) || req.body?.userId;
  if (!userId) return res.status(400).json({ error: "userId required" });

  // 全リプライ取得（PK: USER#userId）
  const params = {
    TableName: "Replies",
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` } },
  };
  try {
    const { Items } = await client.send(new QueryCommand(params));
    res.status(200).json({
      replies: (Items ?? []).map((i) => ({
        id: i.SK.S,
        postId: i.postId?.S ?? "",
        accountId: i.accountId?.S ?? "",
        scheduledAt: Number(i.scheduledAt?.N ?? 0),
        content: i.content?.S ?? "",
        replyContent: i.replyContent?.S ?? "",
        responseContent: i.responseContent?.S ?? "", // ★追加！
        replyAt: i.replyAt?.N ? Number(i.replyAt.N) : null,
        status: i.status?.S ?? "",
        createdAt: i.createdAt?.N ? Number(i.createdAt.N) : null,
      })),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: String(e) });
  }
}
