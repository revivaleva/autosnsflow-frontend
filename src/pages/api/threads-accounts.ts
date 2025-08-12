// /src/pages/api/threads-accounts.ts
import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";
const TBL_THREADS = process.env.TBL_THREADS || "ThreadsAccounts";

const ddb = new DynamoDBClient({ region });

// TODO: 実運用の認証に合わせて取得
function getUserId(req: NextApiRequest): string {
  return (req.headers["x-user-id"] as string)
    || process.env.USER_ID
    || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserId(req);

  try {
    if (req.method === "GET") {
      // [FIX] GETでreq.bodyは読まない
      const out = await ddb.send(new QueryCommand({
        TableName: TBL_THREADS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk":  { S: `USER#${userId}` },
          ":pfx": { S: "ACCOUNT#" },
        },
        ProjectionExpression: "SK, displayName, createdAt, autoPost, autoGenerate, autoReply, statusMessage, personaMode, personaSimple, personaDetail, autoPostGroupId, secondStageContent",
      }));

      const accounts = (out.Items || []).map(i => ({
        accountId: (i.SK?.S || "").replace("ACCOUNT#", ""),
        displayName: i.displayName?.S || "",
        createdAt: Number(i.createdAt?.N || "0"),
        autoPost: i.autoPost?.BOOL ?? false,
        autoGenerate: i.autoGenerate?.BOOL ?? false,
        autoReply: i.autoReply?.BOOL ?? false,
        statusMessage: i.statusMessage?.S || "",
        personaMode: i.personaMode?.S || "",
        personaSimple: i.personaSimple?.S || "",
        personaDetail: i.personaDetail?.S || "",
        autoPostGroupId: i.autoPostGroupId?.S || "",
        secondStageContent: i.secondStageContent?.S || "",
      }));

      // [FIX] フロント互換: accounts と items の両方で返す
      res.status(200).json({ accounts, items: accounts });
      return;
    }

    if (req.method === "PATCH") {
      // [FIX] 期待ボディ: { accountId, autoPost?, autoGenerate?, autoReply? }
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { accountId, autoPost, autoGenerate, autoReply } = body || {};
      if (!accountId) return res.status(400).json({ error: "accountId is required" });

      const names: Record<string, string> = {};
      const values: Record<string, any> = {};
      const sets: string[] = [];

      if (typeof autoPost === "boolean") {
        names["#autoPost"] = "autoPost";
        values[":autoPost"] = { BOOL: autoPost };
        sets.push("#autoPost = :autoPost");
      }
      if (typeof autoGenerate === "boolean") {
        names["#autoGenerate"] = "autoGenerate";
        values[":autoGenerate"] = { BOOL: autoGenerate };
        sets.push("#autoGenerate = :autoGenerate");
      }
      if (typeof autoReply === "boolean") {
        names["#autoReply"] = "autoReply";
        values[":autoReply"] = { BOOL: autoReply };
        sets.push("#autoReply = :autoReply");
      }

      if (sets.length === 0) return res.status(400).json({ error: "no fields to update" });

      const cmd = new UpdateItemCommand({
        TableName: TBL_THREADS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      });

      const out = await ddb.send(cmd);
      const a = out.Attributes || {};
      res.status(200).json({
        accountId,
        autoPost: a.autoPost?.BOOL ?? false,
        autoGenerate: a.autoGenerate?.BOOL ?? false,
        autoReply: a.autoReply?.BOOL ?? false,
      });
      return;
    }

    res.setHeader("Allow", "GET,PATCH");
    res.status(405).end("Method Not Allowed");
  } catch (e: any) {
    console.error("threads-accounts error", e); // [ADD]
    res.status(500).json({ error: e?.message || "internal error" });
  }
}
