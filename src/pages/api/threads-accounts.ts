// /src/pages/api/threads-accounts.ts
// [MOD] GET を backend-core の fetchThreadsAccountsFull に差し替え
//       POST/PUT/PATCH/DELETE は「変更なし」で温存

import type { NextApiRequest, NextApiResponse } from "next";
import {
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

// [ADD] 共通関数を追加インポート（re-exportされます）
import { fetchThreadsAccountsFull } from "@autosnsflow/backend-core";

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";

// [KEEP] PATCH用の更新許可フィールドは現状のまま
const UPDATABLE_FIELDS = new Set([
  "displayName",
  "username",
  "autoPost",
  "autoGenerate",
  "autoReply",
  "statusMessage",
  "personaMode",
  "personaSimple",
  "personaDetail",
  "autoPostGroupId",
  "secondStageContent",
  "accessToken",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // [DEBUG] 認証デバッグ情報
    const cookies = req.headers.cookie || "Cookie無し";
    const auth = req.headers.authorization || "Authorization無し";
    console.log("[DEBUG] Cookie:", cookies.substring(0, 100), "...");
    console.log("[DEBUG] Authorization:", auth);
    
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    console.log("[DEBUG] 認証成功, userId:", userId);

    // ====================
    // [MOD] GET: 共通化
    // ====================
    if (req.method === "GET") {
      // [MOD] ここだけ backend-core を呼ぶ
      console.log("[DEBUG] fetchThreadsAccountsFull を呼び出し中, userId:", userId);
      const list = await fetchThreadsAccountsFull(userId);
      console.log("[DEBUG] fetchThreadsAccountsFull 結果:", list.length, "件", list);

      // 既存APIの応答形式（items配列）に揃える
      // 参考：現行は username / accessToken / auto* / persona* など多数を返却中
      //       （UIが利用している形を踏襲します）
      const items = list.map((it) => ({
        accountId: it.accountId,
        username: it.username,
        displayName: it.displayName,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,

        accessToken: it.accessToken, // [KEEP]

        autoPost: it.autoPost,
        autoGenerate: it.autoGenerate,
        autoReply: it.autoReply,

        statusMessage: it.statusMessage,

        personaMode: it.personaMode,
        personaSimple: it.personaSimple,
        personaDetail: it.personaDetail,

        autoPostGroupId: it.autoPostGroupId,
        secondStageContent: it.secondStageContent,
      }));

      console.log("[DEBUG] API 最終レスポンス:", items.length, "件", items);
      return res.status(200).json({ items });
    }


    if (req.method === "POST") {
      const { accountId, username, displayName, accessToken = "" } = safeBody(req.body);
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      const now = `${Math.floor(Date.now() / 1000)}`;
      await ddb.send(new PutItemCommand({
        TableName: TBL,
        Item: {
          PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` },
          accountId: { S: accountId },
          username: { S: username || "" },
          displayName: { S: displayName || "" },
          accessToken: { S: accessToken }, // [ADD]
          autoPost: { BOOL: false }, autoGenerate: { BOOL: false }, autoReply: { BOOL: false },
          createdAt: { N: now }, updatedAt: { N: now },
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }));
      return res.status(201).json({ ok: true });
    }

    if (req.method === "PUT") {
      // [MOD] フル編集モーダル対応：accessToken / autoPostGroupId / persona* などを一括更新
      const body = safeBody(req.body);
      const { accountId } = body || {};
      if (!accountId) return res.status(400).json({ error: "accountId required" });

      // 動的Update式（未指定は触らない）
      const sets: string[] = ["updatedAt = :ts"];
      const vals: any = { ":ts": { N: `${Math.floor(Date.now() / 1000)}` } };

      const setStr = (k: string, v: any) => {
        const ph = `:v_${k}`;
        sets.push(`${k} = ${ph}`);
        vals[ph] = typeof v === "boolean" ? { BOOL: v } : { S: String(v ?? "") };
      };

      // 基本
      if ("username" in body) setStr("username", body.username);
      if ("displayName" in body) setStr("displayName", body.displayName);
      if ("accessToken" in body) setStr("accessToken", body.accessToken); // [ADD]

      // トグル/メタ
      if ("autoPost" in body) setStr("autoPost", !!body.autoPost);
      if ("autoGenerate" in body) setStr("autoGenerate", !!body.autoGenerate);
      if ("autoReply" in body) setStr("autoReply", !!body.autoReply);
      if ("statusMessage" in body) setStr("statusMessage", body.statusMessage);

      // ペルソナ
      if ("personaMode" in body) setStr("personaMode", body.personaMode);
      if ("personaSimple" in body) setStr("personaSimple", body.personaSimple);
      if ("personaDetail" in body) setStr("personaDetail", body.personaDetail);

      // グループ・2段階
      if ("autoPostGroupId" in body) setStr("autoPostGroupId", body.autoPostGroupId);
      if ("secondStageContent" in body) setStr("secondStageContent", body.secondStageContent);

      if (sets.length === 1) return res.status(400).json({ error: "no fields" });

      await ddb.send(new UpdateItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeValues: vals,
      }));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "PATCH") {
      const body = safeBody(req.body);
      const { accountId, ...rest } = body || {};
      if (!accountId) return res.status(400).json({ error: "accountId required" });

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

function safeBody(b: any) {
  try { return typeof b === "string" ? JSON.parse(b) : (b || {}); }
  catch { return {}; }
}
