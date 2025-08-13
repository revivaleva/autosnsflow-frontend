// /src/pages/api/threads-accounts.ts
// [MOD] GET応答にUIが使う全項目を追加・PATCHを実装・DELETEのbody/Query両対応
import type { NextApiRequest, NextApiResponse } from "next";
import {
  QueryCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb"; // [ADD]
import { verifyUserFromRequest } from "@/lib/auth"; // [ADD]

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";

// [ADD] UIが更新できるホワイトリスト（PATCH用）
const UPDATABLE_FIELDS = new Set([
  "displayName", "username",
  "autoPost", "autoGenerate", "autoReply",
  "statusMessage",
  "personaMode", "personaSimple", "personaDetail",
  "autoPostGroupId",
  "secondStageContent",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req); // [ADD]
    const userId = user.sub;                        // [ADD]

    if (req.method === "GET") {
      const out = await ddb.send(new QueryCommand({
        TableName: TBL,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` } },
        ScanIndexForward: true,
        Limit: 200,
      }));
      const items = (out.Items || []).map((it: any) => ({
        // [KEEP or ADD] UIが期待するフィールドをすべて返す
        accountId: it.accountId?.S || (it.SK?.S || "").replace("ACCOUNT#", ""),
        username: it.username?.S || "",
        displayName: it.displayName?.S || "",
        createdAt: Number(it.createdAt?.N || "0"),
        updatedAt: Number(it.updatedAt?.N || "0"),
        // ▼ここからUI追加項目
        autoPost: Boolean(it.autoPost?.BOOL || false),
        autoGenerate: Boolean(it.autoGenerate?.BOOL || false),
        autoReply: Boolean(it.autoReply?.BOOL || false),
        statusMessage: it.statusMessage?.S || "",
        personaMode: it.personaMode?.S || "",
        personaSimple: it.personaSimple?.S || "",
        personaDetail: it.personaDetail?.S || "",
        autoPostGroupId: it.autoPostGroupId?.S || "",
        secondStageContent: it.secondStageContent?.S || "",
      }));
      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const { accountId, username, displayName } = safeBody(req.body);
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      const now = `${Math.floor(Date.now() / 1000)}`;
      await ddb.send(new PutItemCommand({
        TableName: TBL,
        Item: {
          PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` },
          accountId: { S: accountId },
          username: { S: username || "" },
          displayName: { S: displayName || "" },
          // [ADD] 既定値（UIが即表示できるよう最低限付与）
          autoPost: { BOOL: false }, autoGenerate: { BOOL: false }, autoReply: { BOOL: false },
          createdAt: { N: now }, updatedAt: { N: now },
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)", // [MOD] SKも見る
      }));
      return res.status(201).json({ ok: true });
    }

    if (req.method === "PUT") {
      const { accountId, username, displayName } = safeBody(req.body);
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      await ddb.send(new UpdateItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: "SET username = :u, displayName = :d, updatedAt = :ts",
        ExpressionAttributeValues: {
          ":u": { S: username || "" },
          ":d": { S: displayName || "" },
          ":ts": { N: `${Math.floor(Date.now()/1000)}` },
        },
      }));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "PATCH") {
      // [ADD] トグル等の部分更新（UIのToggleSwitchが使用）
      const body = safeBody(req.body);
      const { accountId, ...rest } = body || {};
      if (!accountId) return res.status(400).json({ error: "accountId required" });

      // 動的にUpdateExpressionを構築（ホワイトリスト外は無視）
      const sets: string[] = ["updatedAt = :ts"];
      const values: any = { ":ts": { N: `${Math.floor(Date.now() / 1000)}` } };
      Object.entries(rest).forEach(([k, v], idx) => {
        if (!UPDATABLE_FIELDS.has(k)) return;
        const ph = `:v${idx}`;
        sets.push(`${k} = ${ph}`);
        values[ph] = typeof v === "boolean" ? { BOOL: v } : { S: String(v ?? "") };
      });
      if (sets.length === 1) return res.status(400).json({ error: "no updatable fields" });

      await ddb.send(new UpdateItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeValues: values,
      }));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      // [MOD] body/Query 両対応に変更（UIはbodyで送信）
      const body = safeBody(req.body);
      const accountId =
        (typeof body?.accountId === "string" && body.accountId) ||
        (typeof req.query.accountId === "string" ? req.query.accountId : "");
      if (!accountId) return res.status(400).json({ error: "accountId required" });

      await ddb.send(new DeleteItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
      }));
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "PATCH", "DELETE"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}

// [ADD] 文字列/JSONの両方を安全に受け取るためのユーティリティ
function safeBody(b: any) {
  try { return typeof b === "string" ? JSON.parse(b) : (b || {}); }
  catch { return {}; }
}
