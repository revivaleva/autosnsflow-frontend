// src/pages/api/threads-accounts.ts

import type { NextApiRequest, NextApiResponse } from 'next'
import { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import jwt from 'jsonwebtoken'

const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

function getUserIdFromToken(token?: string): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.decode(token) as any;
    return decoded?.sub || decoded?.["cognito:username"] || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cookies = req.headers.cookie?.split(";").map((s) => s.trim()) ?? [];
  const idToken = cookies.find((c) => c.startsWith("idToken="))?.split("=")[1];
  const userId = getUserIdFromToken(idToken);
  if (!userId) return res.status(401).json({ error: '認証が必要です（idTokenが無効）' });

  if (req.method === 'GET') {
    const params = {
      TableName: 'ThreadsAccounts',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` } }
    }
    try {
      const { Items } = await client.send(new QueryCommand(params))
      res.status(200).json({ accounts: (Items ?? []).map(i => ({
        accountId: i.SK?.S?.replace('ACCOUNT#', '') ?? '',
        displayName: i.displayName?.S ?? "",
        accessToken: i.accessToken?.S ?? "",
        personaMode: i.personaMode?.S ?? "",
        autoPostGroupId: i.autoPostGroupId?.S ?? "",
        personaSimple: i.personaSimple?.S ?? "",
        personaDetail: i.personaDetail?.S ?? "",
        createdAt: i.createdAt?.N ? Number(i.createdAt.N) : 0,
        autoPost: i.autoPost?.BOOL ?? false,
        autoGenerate: i.autoGenerate?.BOOL ?? false,
        autoReply: i.autoReply?.BOOL ?? false,
        statusMessage: i.statusMessage?.S ?? "",
      })) })
    } catch (e: unknown) {
      return res.status(500).json({ error: String(e) })
    }
    return;
  }

  // POST/PUT/DELETE/PATCH は body を使うため parse 必要
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  if (req.method === 'POST' || req.method === 'PUT') {
    const {
      accountId, displayName, createdAt, accessToken,
      personaDetail, personaSimple, personaMode, autoPostGroupId,
      autoPost, autoGenerate, autoReply, statusMessage,
    } = body;

    if (!accountId || !displayName) {
      return res.status(400).json({ error: "accountId and displayName required" });
    }

    const item: any = {
      PK: { S: `USER#${userId}` },
      SK: { S: `ACCOUNT#${accountId}` },
      displayName: { S: displayName ?? "" },
      accessToken: { S: accessToken ?? "" },
      createdAt: { N: String(createdAt ?? Math.floor(Date.now() / 1000)) },
      personaDetail: { S: personaDetail ?? "{}" },
      personaSimple: { S: personaSimple ?? "" },
      personaMode: { S: personaMode ?? "detail" },
      autoPostGroupId: { S: autoPostGroupId ?? "" },
    };
    if (typeof autoPost === "boolean") item.autoPost = { BOOL: autoPost };
    if (typeof autoGenerate === "boolean") item.autoGenerate = { BOOL: autoGenerate };
    if (typeof autoReply === "boolean") item.autoReply = { BOOL: autoReply };
    if (statusMessage !== undefined) item.statusMessage = { S: statusMessage };

    try {
      await client.send(new PutItemCommand({
        TableName: "ThreadsAccounts",
        Item: item,
      }));
      return res.status(200).json({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  if (req.method === "DELETE") {
    const { accountId } = body;
    if (!accountId) {
      return res.status(400).json({ success: false, error: "accountId required" });
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
    } catch (e: unknown) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  if (req.method === "PATCH") {
    const { accountId, updateFields } = body;
    if (!accountId || !updateFields || Object.keys(updateFields).length === 0) {
      return res.status(400).json({ success: false, error: "accountId, updateFields are required" });
    }
    const updateExp = Object.keys(updateFields)
      .map((k, i) => `#f${i} = :v${i}`).join(", ");
    const exprAttrNames = Object.fromEntries(
      Object.keys(updateFields).map((k, i) => [`#f${i}`, k])
    );
    const exprAttrVals = Object.entries(updateFields).reduce((obj, [k, v], i) => {
      obj[`:v${i}`] = typeof v === "boolean" ? { BOOL: v } : { S: String(v) };
      return obj;
    }, {} as Record<string, any>);
    try {
      await client.send(new UpdateItemCommand({
        TableName: "ThreadsAccounts",
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: "SET " + updateExp,
        ExpressionAttributeNames: exprAttrNames,
        ExpressionAttributeValues: exprAttrVals
      }));
      return res.status(200).json({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ success: false, error: String(e) });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
