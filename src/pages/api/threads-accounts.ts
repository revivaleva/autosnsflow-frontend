// /src/pages/api/threads-accounts.ts
import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

// 既存のregion/envはそのまま流用してください
const region = process.env.AWS_REGION || "ap-northeast-1";
const TBL_THREADS = process.env.TBL_THREADS || "ThreadsAccounts";

// TODO: 認証連携の実装に合わせて取得方法を統一する
function getUserId(req: NextApiRequest): string {
  // セッション/トークンから抽出するのが正。ひとまずヘッダ or 環境変数をフォールバック
  return (req.headers["x-user-id"] as string)
    || process.env.USER_ID
    || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
}

const ddb = new DynamoDBClient({ region });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserId(req);

  try {
    if (req.method === "GET") {
      // [FIX] GETでreq.bodyをパースしない（Amplify Gen1でbodyパースエラーになっていた）
      const q = new QueryCommand({
        TableName: TBL_THREADS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk":  { S: `USER#${userId}` },
          ":pfx": { S: "ACCOUNT#" },
        },
        ProjectionExpression: "SK, displayName, autoPost, autoGenerate, autoReply, autoPostGroupId, personaMode, personaSimple, personaDetail",
      });
      const out = await ddb.send(q);
      const items = (out.Items || []).map(i => ({
        accountId: (i.SK?.S || "").replace("ACCOUNT#", ""),
        displayName: i.displayName?.S || "",
        autoPost: i.autoPost?.BOOL ?? false,
        autoGenerate: i.autoGenerate?.BOOL ?? false,
        autoReply: i.autoReply?.BOOL ?? false,
        autoPostGroupId: i.autoPostGroupId?.S || "",
        personaMode: i.personaMode?.S || "",
        personaSimple: i.personaSimple?.S || "",
        personaDetail: i.personaDetail?.S || "",
      }));
      res.status(200).json({ items });
      return;
    }

    if (req.method === "PATCH") {
      // [ADD] トグル更新（部分更新に対応）
      const { accountId, autoPost, autoGenerate, autoReply } = (typeof req.body === "string") ? JSON.parse(req.body) : req.body;

      if (!accountId) {
        res.status(400).json({ error: "accountId is required" });
        return;
      }

      // 動的Update式を組み立て
      const names: Record<string, string> = {};
      const values: Record<string, any> = {};
      const sets: string[] = [];

      // それぞれ undefined でなければ更新
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

      if (sets.length === 0) {
        res.status(400).json({ error: "no fields to update" });
        return;
      }

      const cmd = new UpdateItemCommand({
        TableName: TBL_THREADS,
        Key: {
          PK: { S: `USER#${userId}` },
          SK: { S: `ACCOUNT#${accountId}` },
        },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      });

      const out = await ddb.send(cmd);
      const item = out.Attributes || {};
      res.status(200).json({
        accountId,
        autoPost: item.autoPost?.BOOL ?? false,
        autoGenerate: item.autoGenerate?.BOOL ?? false,
        autoReply: item.autoReply?.BOOL ?? false,
      });
      return;
    }

    res.setHeader("Allow", "GET,PATCH");
    res.status(405).end("Method Not Allowed");
  } catch (e: any) {
    console.error("threads-accounts api error", e);
    res.status(500).json({ error: e?.message || "internal error" });
  }
}
