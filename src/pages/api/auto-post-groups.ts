// src/pages/api/auto-post-groups.ts

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb'
import jwt from 'jsonwebtoken'

const client = new DynamoDBClient({ region: 'ap-northeast-1' })

// JWTからuserId取得
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
  // CookieからidToken取得
  const cookies = req.headers.cookie?.split(";").map((s) => s.trim()) ?? [];
  const idToken = cookies.find((c) => c.startsWith("idToken="))?.split("=")[1];
  const userId = getUserIdFromToken(idToken);

  if (!userId) return res.status(401).json({ error: '認証が必要です（idTokenが無効）' });

  // 一覧取得
  if (req.method === 'GET') {
    const params = {
      TableName: 'AutoPostGroups',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` } },
    };
    try {
      const { Items } = await client.send(new QueryCommand(params));
      res.status(200).json({
        groups:
          Items?.map((i) => ({
            groupKey: i.SK?.S || "",
            groupName: i.groupName?.S || "",
            time1: i.time1?.S || "",
            theme1: i.theme1?.S || "",
            time2: i.time2?.S || "",
            theme2: i.theme2?.S || "",
            time3: i.time3?.S || "",
            theme3: i.theme3?.S || "",
            createdAt: i.createdAt?.N ? Number(i.createdAt.N) : undefined,
          })) || [],
      });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  // 追加・編集（PutItemで新規/上書きどちらも対応）
  if (req.method === 'POST' || req.method === 'PUT') {
    // Next.jsのAPIルートはbodyがJSONまたはstringで来る場合がある
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      groupKey,
      groupName,
      time1,
      theme1,
      time2,
      theme2,
      time3,
      theme3,
      createdAt,
    } = body;
    if (!groupKey || !groupName) {
      return res.status(400).json({ error: "groupKey and groupName required" });
    }
    // createdAt: number。なければ現在時刻をセット
    let createdAtNumber = Number(createdAt);
    if (!createdAtNumber || isNaN(createdAtNumber)) {
      createdAtNumber = Math.floor(Date.now() / 1000);
    }

    const params = {
      TableName: "AutoPostGroups",
      Item: {
        PK: { S: `USER#${userId}` },
        SK: { S: String(groupKey) },
        groupName: { S: String(groupName) },
        time1: { S: time1 || "" },
        theme1: { S: theme1 || "" },
        time2: { S: time2 || "" },
        theme2: { S: theme2 || "" },
        time3: { S: time3 || "" },
        theme3: { S: theme3 || "" },
        createdAt: { N: String(createdAtNumber) },
      },
    };
    try {
      await client.send(new PutItemCommand(params));
      return res.status(200).json({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  // 削除
  if (req.method === 'DELETE') {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { groupKey } = body;
    if (!groupKey) {
      return res.status(400).json({ error: "groupKey required" });
    }
    try {
      await client.send(
        new DeleteItemCommand({
          TableName: "AutoPostGroups",
          Key: {
            PK: { S: `USER#${userId}` },
            SK: { S: String(groupKey) },
          },
        })
      );
      return res.status(200).json({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  // その他
  return res.status(405).json({ error: "Method Not Allowed" });
}
