// /src/pages/api/scheduled-posts.ts

import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "ap-northeast-1" });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const userId =
    (req.query.userId as string) ||
    (typeof req.body === "string"
      ? JSON.parse(req.body).userId
      : req.body?.userId);
  if (!userId)
    return res.status(400).json({ error: "userId required" });

  // 一覧取得＋各postごとにRepliesも取得
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
          const postId = i.postId?.S ?? ""; // ←ここで投稿IDを取得
          const scheduledPostId = i.SK?.S?.replace("SCHEDULEDPOST#", "") ?? "";
          // Repliesテーブルから取得
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
          } catch (e: unknown) {
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
            replies, // ← 追加
          };
        })
      );
      res.status(200).json({ posts });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  // 登録
  if (req.method === "POST") {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const {
      scheduledPostId,
      accountId,
      accountName,
      autoPostGroupId,
      theme,
      content,
      scheduledAt,
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

  // 論理削除
  if (req.method === "PATCH") {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { scheduledPostId, isDeleted } = body;
    if (!scheduledPostId)
      return res.status(400).json({ error: "scheduledPostId required" });

    // 1. 既存Item取得
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

    // 2. isDeletedだけ上書きして再Put
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
