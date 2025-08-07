// /src/pages/api/auto-post-groups.ts

import type { NextApiRequest, NextApiResponse } from 'next'
import { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'ap-northeast-1' })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // PKはユーザーID（"USER#xxx"）
  const userId = (req.query.userId as string) || req.body?.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // 一覧取得
  if (req.method === 'GET') {
    const params = {
      TableName: 'AutoPostGroups',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` } }
    };
    try {
      const { Items } = await client.send(new QueryCommand(params));
      res.status(200).json({
        groups: Items?.map(i => ({
          groupKey: i.SK.S, // 例: "GROUP#g1"
          groupName: i.groupName?.S || "",
          time1: i.time1?.S || "",
          theme1: i.theme1?.S || "",
          time2: i.time2?.S || "",
          theme2: i.theme2?.S || "",
          time3: i.time3?.S || "",
          theme3: i.theme3?.S || "",
          createdAt: i.createdAt ? Number(i.createdAt.N) : undefined,
        })) || []
      });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  // 追加・編集（PutItemで新規/上書きどちらも対応）
  if (req.method === 'POST' || req.method === 'PUT') {
    const {
      groupKey, // 例: "GROUP#g1"
      groupName, time1, theme1, time2, theme2, time3, theme3, createdAt,
    } = req.body;
    if (!groupKey || !groupName) {
      return res.status(400).json({ error: "groupKey and groupName required" });
    }
    const params = {
      TableName: "AutoPostGroups",
      Item: {
        PK: { S: `USER#${userId}` },
        SK: { S: groupKey },
        groupName: { S: groupName },
        time1: { S: time1 || "" },
        theme1: { S: theme1 || "" },
        time2: { S: time2 || "" },
        theme2: { S: theme2 || "" },
        time3: { S: time3 || "" },
        theme3: { S: theme3 || "" },
        createdAt: { N: String(createdAt ?? Math.floor(Date.now() / 1000)) },
      }
    };
    try {
      await client.send(new PutItemCommand(params));
      return res.status(200).json({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  // 削除（SK=groupKey指定。事前に関連ThreadsAccountsが無いことをフロント等でチェック）
  if (req.method === 'DELETE') {
    const { groupKey } = req.body;
    if (!groupKey) {
      return res.status(400).json({ error: "groupKey required" });
    }
    try {
      await client.send(new DeleteItemCommand({
        TableName: "AutoPostGroups",
        Key: {
          PK: { S: `USER#${userId}` },
          SK: { S: groupKey }
        }
      }));
      return res.status(200).json({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  // その他
  return res.status(405).json({ error: "Method Not Allowed" });
}
