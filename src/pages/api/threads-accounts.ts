// src/pages/api/threads-accounts.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'


const client = new DynamoDBClient({ region: 'ap-northeast-1' })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = (req.query.userId as string) || req.body?.userId; // POST/PUT時はbodyから取得
  if (!userId) return res.status(400).json({ error: 'userId required' });

  if (req.method === 'GET') {
    // 一覧取得
    const params = {
      TableName: 'ThreadsAccounts',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` } }
    }
    try {
      const { Items } = await client.send(new QueryCommand(params))
      res.status(200).json({ accounts: Items?.map(i => ({
        accountId: i.SK.S.replace('ACCOUNT#', ''),
        displayName: i.displayName.S,
        accessToken: i.accessToken?.S || "",   // ← ここを追加
        personaMode: i.personaMode?.S || "",
        autoPostGroupId: i.autoPostGroupId?.S || "",
        personaSimple: i.personaSimple?.S || "",
        personaDetail: i.personaDetail?.S || "",
        createdAt: Number(i.createdAt.N),
        // ここを追加！
        autoPost: i.autoPost ? i.autoPost.BOOL : false,
        autoGenerate: i.autoGenerate ? i.autoGenerate.BOOL : false,
        autoReply: i.autoReply ? i.autoReply.BOOL : false,
        statusMessage: i.statusMessage?.S || "",
      })) || [] })
    } catch (e) {
      res.status(500).json({ error: String(e) })
    }
  }
  
  // 追加・編集
  if (req.method === 'POST' || req.method === 'PUT') {
    const {
      accountId, displayName, createdAt, accessToken,
      personaDetail, personaSimple, personaMode, autoPostGroupId
      // 必要に応じ他フィールドも追加
    } = req.body;

    if (!accountId || !displayName) {
      return res.status(400).json({ error: "accountId and displayName required" });
    }

    const params = {
      TableName: "ThreadsAccounts",
      Item: {
        PK: { S: `USER#${userId}` },
        SK: { S: `ACCOUNT#${accountId}` },
        displayName: { S: displayName },
        accessToken: { S: accessToken },   // ← ここを追加
        createdAt: { N: String(createdAt ?? Math.floor(Date.now() / 1000)) },
        personaDetail: { S: personaDetail || "{}" },
        personaSimple: { S: personaSimple || "" },
        personaMode: { S: personaMode || "detail" },
        autoPostGroupId: { S: autoPostGroupId || "" },
      }
    };

    try {
      await client.send(new PutItemCommand(params));
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }
  
  // 削除
  if (req.method === "DELETE") {
    const { userId, accountId } = req.body;
    if (!userId || !accountId) {
      return res.status(400).json({ success: false, error: "userId and accountId required" });
    }
    try {
      await client.send(new DeleteItemCommand({
        TableName: "ThreadsAccounts",
        Key: {
          PK: { S: `USER#${userId}` },
          SK: { S: `ACCOUNT#${accountId}` }
        }
      }));
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  // PATCH: トグル用部分更新
  if (req.method === "PATCH") {
    const { userId, accountId, updateFields } = req.body;
    if (!userId || !accountId || !updateFields) {
      return res.status(400).json({ success: false, error: "userId, accountId, updateFields are required" });
    }
    const updateExp = Object.keys(updateFields)
      .map((k, i) => `#f${i} = :v${i}`).join(", ");
    const exprAttrNames = Object.fromEntries(
      Object.keys(updateFields).map((k, i) => [`#f${i}`, k])
    );
    const exprAttrVals = Object.fromEntries(
      Object.values(updateFields).map((v, i) => [`:v${i}`, typeof v === "boolean" ? { BOOL: v } : { S: String(v) }])
    );
    try {
      await client.send(new UpdateItemCommand({
        TableName: "ThreadsAccounts",
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: "SET " + updateExp,
        ExpressionAttributeNames: exprAttrNames,
        ExpressionAttributeValues: exprAttrVals
      }));
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }
}
