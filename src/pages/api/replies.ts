import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  QueryCommand
} from "@aws-sdk/client-dynamodb";
import jwt from "jsonwebtoken";

// Amplify Hosting (Gen1) でシークレット環境変数を読み込み
const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,  // 公開してもよい
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

// JWTからuserId取得（subまたはcognito:username）
function getUserIdFromToken(token?: string): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.decode(token) as any;
    return decoded?.sub || decoded?.["cognito:username"] || null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const cookies = req.headers.cookie?.split(";").map((s) => s.trim()) ?? [];
  const idToken = cookies.find((c) => c.startsWith("idToken="))?.split("=")[1];
  const userId = getUserIdFromToken(idToken);

  if (!userId) return res.status(401).json({ error: "認証が必要です（idTokenが無効）" });

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
        responseContent: i.responseContent?.S ?? "",
        replyAt: i.replyAt?.N ? Number(i.replyAt.N) : null,
        status: i.status?.S ?? "",
        createdAt: i.createdAt?.N ? Number(i.createdAt.N) : null,
      })),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: String(e) });
  }
}
