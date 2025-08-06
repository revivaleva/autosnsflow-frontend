// /src/pages/api/scheduled-posts.ts

import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "ap-northeast-1" });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const userId = (req.query.userId as string) || req.body?.userId;
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
          const scheduledPostId = i.SK.S.replace("SCHEDULEDPOST#", "");
          // Repliesテーブルから取得
          let replies = [];
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
          } catch (e) {
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
            replies, // ← 追加
          };
        })
      );
      res.status(200).json({ posts });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  // 登録
  if (req.method === "POST") {
    const {
      scheduledPostId,
      accountId,
      accountName,
      autoPostGroupId,
      theme,
      content,
      scheduledAt,
    } = req.body;
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
          },
        })
      );
      res.status(200).json({ success: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  // 論理削除
  if (req.method === "PATCH") {
    const { scheduledPostId, isDeleted } = req.body;
    if (!scheduledPostId)
      return res.status(400).json({ error: "scheduledPostId required" });
    try {
      await client.send(
        new PutItemCommand({
          TableName: "ScheduledPosts",
          Item: {
            PK: { S: `USER#${userId}` },
            SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
            isDeleted: { BOOL: !!isDeleted },
            // 他フィールドは上書き用に適宜取得・再セットしてください
          },
        })
      );
      res.status(200).json({ success: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }
  res.status(405).end();
}
// /src/pages/api/scheduled-posts.ts
