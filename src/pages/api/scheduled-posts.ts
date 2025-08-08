import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import jwt from "jsonwebtoken";

// シークレット環境変数からDynamoDBクライアントを初期化
const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION, // 公開しても問題ない
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

function getUserIdFromToken(token?: string): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.decode(token) as any;
    return decoded?.sub || decoded?.['cognito:username'] || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cookies = req.headers.cookie?.split(";").map((s) => s.trim()) ?? [];
  const idToken = cookies.find((c) => c.startsWith("idToken="))?.split("=")[1];
  const userId = getUserIdFromToken(idToken);

  if (!userId)
    return res.status(401).json({ error: "認証が必要です（idTokenが無効）" });

  if (req.method === "GET") {
    const params = {
      TableName: "ScheduledPosts",
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` } },
    };
    try {
      const { Items } = await client.send(new QueryCommand(params));
      const posts = await Promise.all(
        (Items ?? []).map(async (i) => {
          const postId = i.postId?.S ?? "";
          const scheduledPostId = i.SK?.S?.replace("SCHEDULEDPOST#", "") ?? "";
          let replies: any[] = [];
          try {
            const repliesRes = await client.send(
              new QueryCommand({
                TableName: "Replies",
                KeyConditionExpression: "PK = :pk",
                FilterExpression: "postId = :postId",
                ExpressionAttributeValues: {
                  ":pk": { S: `USER#${userId}` },
                  ":postId": { S: postId },
                },
              })
            );
            replies = (repliesRes.Items ?? []).map((r) => ({
              id: r.SK.S,
              replyContent: r.replyContent?.S ?? "",
              status: r.status?.S ?? "",
              createdAt: Number(r.createdAt?.N ?? 0),
              replyAt: Number(r.replyAt?.N ?? 0),
              errorDetail: r.errorDetail?.S ?? "",
            }));
          } catch {
            replies = [];
          }
          return {
            scheduledPostId,
            accountId: i.accountId?.S ?? "",
            accountName: i.accountName?.S ?? "",
            autoPostGroupId: i.autoPostGroupId?.S ?? "",
            theme: i.theme?.S ?? "",
            content: i.content?.S ?? "",
            scheduledAt: Number(i.scheduledAt?.N ?? 0),
            postedAt: Number(i.postedAt?.N ?? 0),
            status: i.status?.S ?? "",
            replyCount: Number(i.replyCount?.N ?? 0),
            postId: i.postId?.S ?? "",
            createdAt: Number(i.createdAt?.N ?? 0),
            isDeleted: !!i.isDeleted?.BOOL,
            replies,
          };
        })
      );
      res.status(200).json({ posts });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const {
      scheduledPostId, accountId, accountName, autoPostGroupId,
      theme, content, scheduledAt,
    } = body;
    if (!scheduledPostId || !accountId)
      return res.status(400).json({ error: "scheduledPostId/accountId required" });
    try {
      await client.send(
        new PutItemCommand({
          TableName: "ScheduledPosts",
          Item: {
            PK: { S: `USER#${userId}` },
            SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
            scheduledPostId: { S: scheduledPostId },
            accountId: { S: accountId },
            accountName: { S: accountName ?? "" },
            autoPostGroupId: { S: autoPostGroupId ?? "" },
            theme: { S: theme ?? "" },
            content: { S: content ?? "" },
            scheduledAt: { N: String(scheduledAt ?? Math.floor(Date.now() / 1000)) },
            postedAt: { N: "0" },
            status: { S: "scheduled" },
            replyCount: { N: "0" },
            postId: { S: "" },
            createdAt: { N: String(Math.floor(Date.now() / 1000)) },
            isDeleted: { BOOL: false },
          },
        })
      );
      res.status(200).json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  if (req.method === "PATCH") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { scheduledPostId, isDeleted } = body;
    if (!scheduledPostId)
      return res.status(400).json({ error: "scheduledPostId required" });

    let existing;
    try {
      const resItem = await client.send(
        new GetItemCommand({
          TableName: "ScheduledPosts",
          Key: {
            PK: { S: `USER#${userId}` },
            SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
          },
        })
      );
      existing = resItem.Item;
      if (!existing)
        return res.status(404).json({ error: "Not found" });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }

    const updatedItem = {
      ...existing,
      isDeleted: { BOOL: !!isDeleted },
    };
    try {
      await client.send(
        new PutItemCommand({
          TableName: "ScheduledPosts",
          Item: updatedItem,
        })
      );
      res.status(200).json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  res.status(405).end();
}
