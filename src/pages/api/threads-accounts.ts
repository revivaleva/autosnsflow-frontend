// /src/pages/api/threads-accounts.ts
// [MOD] GET を backend-core の fetchThreadsAccountsFull に差し替え
//       POST/PUT/PATCH/DELETE は「変更なし」で温存

import type { NextApiRequest, NextApiResponse } from "next";
import {
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  GetItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

// [ADD] 共通関数を追加インポート（re-exportされます）
import { fetchThreadsAccountsFull } from "@autosnsflow/backend-core";

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

// [KEEP] PATCH用の更新許可フィールドは現状のまま
const UPDATABLE_FIELDS = new Set([
  "displayName",
  "username",
  "autoPost",
  "autoGenerate",
  "autoReply",
  "autoQuote",
  "statusMessage",
  "personaMode",
  "personaSimple",
  "personaDetail",
  "autoPostGroupId",
  "secondStageContent",
  "monitoredAccountId",
  "quoteTimeStart",
  "quoteTimeEnd",
  "accessToken",
  "oauthAccessToken",
  "clientId",
  "clientSecret",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    // ====================
    // [MOD] GET: 共通化
    // ====================
    if (req.method === "GET") {
      // [MOD] ここだけ backend-core を呼ぶ
      const list = await fetchThreadsAccountsFull(userId);

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
        oauthAccessToken: (it as any).oauthAccessToken || "", // add oauthAccessToken so frontend can use oauth token where needed
        // providerUserId may not be present on the declared type from backend-core
        // so access it defensively to avoid TypeScript build errors.
        providerUserId: (it as any).providerUserId || (it as any).provider_user_id || "", // [ADD] リプライ取得に必要

        autoPost: it.autoPost,
        autoGenerate: it.autoGenerate,
        autoReply: it.autoReply,
        autoQuote: (it as any).autoQuote || false,

        statusMessage: it.statusMessage,
        // アカウントの状態 (deleting / deletion_error / active 等)。backend-core に無ければ 'active' をデフォルト
        status: (it as any).status || (it as any).state || 'active',

        personaMode: it.personaMode,
        personaSimple: it.personaSimple,
        personaDetail: it.personaDetail,

        autoPostGroupId: it.autoPostGroupId,
        secondStageContent: it.secondStageContent,
        monitoredAccountId: (it as any).monitoredAccountId || (it as any).monitored_account_id || "",
        quoteTimeStart: (it as any).quoteTimeStart || "",
        quoteTimeEnd: (it as any).quoteTimeEnd || "",
        // clientId/clientSecret may be present under various names depending on origin
        clientId: (it as any).clientId || (it as any).client_id || ((it as any).client && (it as any).client.id) || "",
        // Do not expose clientSecret plaintext. Instead expose a boolean flag indicating presence.
        hasClientSecret: !!((it as any).clientSecret || (it as any).client_secret || ((it as any).client && (it as any).client.secret)),
      }));

      // If backend-core didn't return clientId/secret fields, fetch them directly from DynamoDB as fallback
      // Also always read status from DynamoDB to reflect deletion state even if backend-core omits it.
      for (let i = 0; i < items.length; i++) {
        const acc = items[i];
        try {
          const out = await ddb.send(new GetItemCommand({
            TableName: TBL,
            Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${acc.accountId}` } },
            // include fields so fallback read returns the attribute when present
            ProjectionExpression: 'clientId, clientSecret, oauthAccessToken, #st, monitoredAccountId, autoQuote, quoteTimeStart, quoteTimeEnd',
            ExpressionAttributeNames: { '#st': 'status' },
          }));
          const it: any = (out as any).Item || {};
          if (!acc.clientId && it.clientId && it.clientId.S) acc.clientId = it.clientId.S;
          if (!acc.hasClientSecret && it.clientSecret && it.clientSecret.S) acc.hasClientSecret = true;
          // DynamoDB 側に status が保存されている場合は反映（backend-core の値を上書きしない）
          if (it.status && it.status.S) acc.status = it.status.S;
          // monitoredAccountId が DynamoDB にあれば反映
          if (it.monitoredAccountId && it.monitoredAccountId.S) acc.monitoredAccountId = it.monitoredAccountId.S;
          if (it.quoteTimeStart && it.quoteTimeStart.S) acc.quoteTimeStart = it.quoteTimeStart.S;
          if (it.quoteTimeEnd && it.quoteTimeEnd.S) acc.quoteTimeEnd = it.quoteTimeEnd.S;
          // autoQuote が DynamoDB にあれば反映
          if (typeof it.autoQuote !== 'undefined') {
            // autoQuote may be stored as BOOL
            if (typeof it.autoQuote.BOOL !== 'undefined') acc.autoQuote = !!it.autoQuote.BOOL;
            else if (typeof it.autoQuote.S !== 'undefined') acc.autoQuote = String(it.autoQuote.S) === 'true';
          }
          // 追加: DeletionQueue にアイテムが存在するか確認し、存在すれば強制的に deleting を返す
          try {
            const dq = await ddb.send(new QueryCommand({
              TableName: process.env.TBL_DELETION_QUEUE || 'DeletionQueue',
              KeyConditionExpression: 'PK = :pk',
              ExpressionAttributeValues: { ':pk': { S: `ACCOUNT#${acc.accountId}` } },
              Limit: 1,
            }));
            const dqItems = (dq as any).Items || [];
            if (dqItems.length > 0) {
              acc.status = 'deleting';
            }
          } catch (e) {
            console.warn('[threads-accounts] deletionQueue check failed', e);
          }
        } catch (e) {
          console.warn('[threads-accounts] fallback read item failed', e);
        }
      }

      return res.status(200).json({ items });
    }


    if (req.method === "POST") {
      const { accountId, username, displayName, accessToken = "", oauthAccessToken = "", clientId, clientSecret, monitoredAccountId, quoteTimeStart, quoteTimeEnd, personaDetail, personaSimple, personaMode, autoPostGroupId, secondStageContent } = safeBody(req.body);
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      // Prevent creating the same SK for different users: check if any existing item with SK ACCOUNT#<accountId> exists for a different PK
      try {
        const q = await ddb.send(new QueryCommand({
          TableName: TBL,
          IndexName: 'GSI1',
          KeyConditionExpression: 'SK = :sk',
          ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${accountId}` } },
          ProjectionExpression: 'PK',
          Limit: 1,
        }));
        const existing = (q as any).Items || [];
        if (existing.length > 0) {
          const pk = existing[0].PK?.S || '';
          const existingUser = pk.startsWith('USER#') ? pk.replace(/^USER#/, '') : pk;
          if (existingUser !== userId) {
            return res.status(409).json({ error: 'accountId already registered for another user' });
          }
        }
      } catch (e) {
        // if query by GSI fails (no index), fall back to a scan with caution
        try {
          const scan = await ddb.send(new ScanCommand({ TableName: TBL, FilterExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: 'PK', Limit: 1 }));
          const items = (scan as any).Items || [];
          if (items.length > 0) {
            const pk = items[0].PK?.S || '';
            const existingUser = pk.startsWith('USER#') ? pk.replace(/^USER#/, '') : pk;
            if (existingUser !== userId) return res.status(409).json({ error: 'accountId already registered for another user' });
          }
        } catch (e2) {
          // debug output removed
        }
      }
      // === enforce per-user account creation limit ===
      try {
        const outSettings = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: { S: `USER#${userId}` }, SK: { S: 'SETTINGS' } }, ProjectionExpression: 'maxThreadsAccounts' }));
        const sitem: any = (outSettings as any).Item || {};
        const maxAllowed = typeof sitem.maxThreadsAccounts?.N !== 'undefined' ? Number(sitem.maxThreadsAccounts.N) : null;
        if (maxAllowed !== null) {
          // 0 means "no additional accounts allowed"
          if (maxAllowed === 0) {
            return res.status(403).json({ error: 'account_limit_reached', message: 'アカウント作成は許可されていません' });
          }
          // count existing accounts for this user
          try {
            const qc = await ddb.send(new QueryCommand({ TableName: TBL, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } }, Select: 'COUNT' }));
            const existingCount = typeof (qc as any).Count === 'number' ? (qc as any).Count : Number((qc as any).Count || 0);
            if (existingCount >= maxAllowed) {
              return res.status(403).json({ error: 'account_limit_reached', message: `作成上限に達しています（上限: ${maxAllowed}）` });
            }
          } catch (e) {
            console.warn('[threads-accounts] count existing accounts failed', e);
            // if counting fails, allow creation to avoid accidental lockout
          }
        }
      } catch (e) {
        console.warn('[threads-accounts] read user settings failed', e);
        // allow creation if settings cannot be read
      }

      const now = `${Math.floor(Date.now() / 1000)}`;
      const item: any = {
        PK: { S: `USER#${userId}` },
        SK: { S: `ACCOUNT#${accountId}` },
        accountId: { S: accountId },
        username: { S: username || "" },
        displayName: { S: displayName || "" },
        accessToken: { S: accessToken }, // [ADD]
        oauthAccessToken: { S: oauthAccessToken },
        autoPost: { BOOL: false },
        autoGenerate: { BOOL: false },
        autoReply: { BOOL: false },
        createdAt: { N: now },
        updatedAt: { N: now },
      };
      // Optional persona fields
      if (typeof personaMode !== 'undefined') item.personaMode = { S: String(personaMode || '') };
      if (typeof personaSimple !== 'undefined') item.personaSimple = { S: String(personaSimple || '') };
      if (typeof personaDetail !== 'undefined') item.personaDetail = { S: String(personaDetail || '') };
      if (autoPostGroupId) item.autoPostGroupId = { S: String(autoPostGroupId) };
      if (secondStageContent) item.secondStageContent = { S: String(secondStageContent) };
      // If clientId/clientSecret not provided or empty, try to fallback to user default settings
      if (clientId) {
        item.clientId = { S: String(clientId) };
      }
      if (clientSecret) {
        item.clientSecret = { S: String(clientSecret) };
      }
      if (!item.clientId || !item.clientSecret) {
        try {
          const out = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: { S: `USER#${userId}` }, SK: { S: 'SETTINGS' } }, ProjectionExpression: 'defaultThreadsClientId,defaultThreadsClientSecret' }));
          const s: any = (out as any).Item || {};
          if (!item.clientId && s.defaultThreadsClientId && s.defaultThreadsClientId.S) {
            item.clientId = { S: s.defaultThreadsClientId.S };
          }
          if (!item.clientSecret && s.defaultThreadsClientSecret && s.defaultThreadsClientSecret.S) {
            item.clientSecret = { S: s.defaultThreadsClientSecret.S };
          }
        } catch (e) {
          // debug output removed
        }
      }
      if (monitoredAccountId) {
        item.monitoredAccountId = { S: String(monitoredAccountId) };
      }
      // Ensure defaults for quote time when not provided: full day
      item.quoteTimeStart = { S: String(typeof quoteTimeStart !== 'undefined' && quoteTimeStart !== '' ? quoteTimeStart : '00:00') };
      item.quoteTimeEnd = { S: String(typeof quoteTimeEnd !== 'undefined' && quoteTimeEnd !== '' ? quoteTimeEnd : '23:59') };

      // Ensure we are not creating duplicate account items with mismatched PKs.
      // Use conditional Put: only create when the exact PK/SK doesn't exist.
      await ddb.send(new PutItemCommand({
        TableName: TBL,
        Item: item,
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
      // If clientId/clientSecret fields are present but empty, attempt to fallback to user default settings
      let effectiveClientId: any = undefined;
      let effectiveClientSecret: any = undefined;
      if ("clientId" in body) effectiveClientId = body.clientId;
      if ("clientSecret" in body) effectiveClientSecret = body.clientSecret;
      if (("clientId" in body && (!effectiveClientId || String(effectiveClientId).trim() === "")) || ("clientSecret" in body && (!effectiveClientSecret || String(effectiveClientSecret).trim() === ""))) {
        try {
          const out = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { PK: { S: `USER#${userId}` }, SK: { S: 'SETTINGS' } }, ProjectionExpression: 'defaultThreadsClientId,defaultThreadsClientSecret' }));
          const s: any = (out as any).Item || {};
          if (("clientId" in body) && (!effectiveClientId || String(effectiveClientId).trim() === "") && s.defaultThreadsClientId && s.defaultThreadsClientId.S) {
            effectiveClientId = s.defaultThreadsClientId.S;
          }
          if (("clientSecret" in body) && (!effectiveClientSecret || String(effectiveClientSecret).trim() === "") && s.defaultThreadsClientSecret && s.defaultThreadsClientSecret.S) {
            effectiveClientSecret = s.defaultThreadsClientSecret.S;
          }
        } catch (e) {
          // debug output removed
        }
      }
      if ("clientId" in body) setStr("clientId", effectiveClientId);
      if ("clientSecret" in body) setStr("clientSecret", effectiveClientSecret);

      // トグル/メタ
      if ("autoPost" in body) setStr("autoPost", !!body.autoPost);
      if ("autoGenerate" in body) setStr("autoGenerate", !!body.autoGenerate);
      if ("autoReply" in body) setStr("autoReply", !!body.autoReply);
      if ("autoQuote" in body) setStr("autoQuote", !!body.autoQuote);
      if ("statusMessage" in body) setStr("statusMessage", body.statusMessage);

      // ペルソナ
      if ("personaMode" in body) setStr("personaMode", body.personaMode);
      if ("personaSimple" in body) setStr("personaSimple", body.personaSimple);
      if ("personaDetail" in body) setStr("personaDetail", body.personaDetail);

      // グループ・2段階
      if ("autoPostGroupId" in body) setStr("autoPostGroupId", body.autoPostGroupId);
      if ("secondStageContent" in body) setStr("secondStageContent", body.secondStageContent);
      if ("monitoredAccountId" in body) setStr("monitoredAccountId", body.monitoredAccountId);
      // quoteTime は空文字の場合にデフォルト値を与えるため、下のブロックで一度だけ設定する
      if ("quoteTimeStart" in body) {
        const v = (body.quoteTimeStart === undefined || body.quoteTimeStart === '') ? '00:00' : String(body.quoteTimeStart);
        setStr("quoteTimeStart", v);
      }
      if ("quoteTimeEnd" in body) {
        const v = (body.quoteTimeEnd === undefined || body.quoteTimeEnd === '') ? '23:59' : String(body.quoteTimeEnd);
        setStr("quoteTimeEnd", v);
      }

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
      // Log deauthorization actions for audit when oauthAccessToken is explicitly cleared
      try {
        const cleared = Object.prototype.hasOwnProperty.call(rest, 'oauthAccessToken') && String(rest.oauthAccessToken || '').trim() === '';
        if (cleared) {
          try {
            const putLog = (await import('@/lib/logger')).putLog;
            try { await putLog({ userId, action: 'deauthorize', accountId, status: 'info', message: 'oauthAccessToken cleared by user' }); } catch (e) {}
          } catch (e) {}
        }
      } catch (e) {}
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
