import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand, DeleteItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_X_SCHEDULED || "XScheduledPosts";
const TBL_X = process.env.TBL_X_ACCOUNTS || "XAccounts";
const TBL_SETTINGS = process.env.TBL_USER_TYPE_TIME_SETTINGS || "UserTypeTimeSettings";

// Simple in-memory rate limit map (userId -> lastTs). Works for single instance.
const lastRunMap: Record<string, number> = {};
const COOLDOWN_SEC = Number(process.env.REGEN_COOLDOWN_SEC || "60");

function yyyymmddJst(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}

function randomTimeInRangeJst(windowStr: string, baseDate: Date) {
  try {
    const parts = String(windowStr).split(/-|～|~/).map((x) => String(x).trim());
    const start = parts[0]; const end = parts[1];
    if (!start || !end) return null;
    const [sh, sm] = start.split(":").map((x) => Number(x));
    const [eh, em] = end.split(":").map((x) => Number(x));
    // baseDate is JS Date (local), we need JST midnight of baseDate
    const jstMs = baseDate.getTime() + (9 * 3600 * 1000);
    const jst = new Date(jstMs);
    const jstStartOfDayMs = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 0, 0, 0);
    const startMsJst = jstStartOfDayMs + (sh * 3600 + sm * 60) * 1000;
    const endMsJst = jstStartOfDayMs + (eh * 3600 + em * 60) * 1000;
    // convert back to epoch ms
    const startEpochMs = startMsJst - (9 * 3600 * 1000);
    const endEpochMs = endMsJst - (9 * 3600 * 1000);
    if (!isFinite(startEpochMs) || !isFinite(endEpochMs) || endEpochMs <= startEpochMs) return null;
    const chosen = Math.floor(Math.random() * (endEpochMs - startEpochMs)) + startEpochMs;
    return new Date(chosen);
  } catch (e) {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ error: "method_not_allowed" });
    }
    const user = await verifyUserFromRequest(req).catch(() => null);
    if (!user?.sub) return res.status(401).json({ error: "unauthorized" });
    const userId = user.sub;
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const poolType = String(body.type || "").trim();
    if (!poolType) return res.status(400).json({ error: "type_required" });

    // simple rate limit
    const nowSec = Math.floor(Date.now() / 1000);
    const last = lastRunMap[userId] || 0;
    if (nowSec - last < COOLDOWN_SEC) {
      return res.status(429).json({ error: "rate_limited", retry_after: COOLDOWN_SEC - (nowSec - last) });
    }
    lastRunMap[userId] = nowSec;

    // fixed windows
    const fixedWindows = ["07:00-09:00", "12:00-14:00", "17:00-21:00"];

    // Load user settings for this type
    let morningOn = false, noonOn = false, nightOn = false;
    try {
      const sres = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key: { user_id: { S: String(userId) }, type: { S: poolType } } }));
      const sitem = (sres as any).Item || {};
      morningOn = Boolean(sitem.morning && (sitem.morning.BOOL === true || String(sitem.morning.S) === 'true'));
      noonOn = Boolean(sitem.noon && (sitem.noon.BOOL === true || String(sitem.noon.S) === 'true'));
      nightOn = Boolean(sitem.night && (sitem.night.BOOL === true || String(sitem.night.S) === 'true'));
    } catch (e) {
      // leave defaults false
    }

    // Get user's X accounts
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_X,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: "ACCOUNT#" } },
    }));
    const xitems: any[] = (q as any).Items || [];
    const accounts = xitems.map(it => ({
      accountId: it.accountId?.S || (it.SK?.S || '').replace(/^ACCOUNT#/, ''),
      displayName: it.username?.S || it.accountName?.S || it.accountId?.S || (it.SK?.S || '').replace(/^ACCOUNT#/, ''),
      type: it.type?.S || 'general',
      autoPostEnabled: it.autoPostEnabled?.BOOL === true,
    })).filter(a => (a.type || 'general') === poolType && a.autoPostEnabled === true);
    const accountsSet = new Set(accounts.map(a => a.accountId));

    // Fetch today's and tomorrow's scheduled posts for this user
    // Try to use GSI_ByPoolDate if configured to fetch only poolType + scheduledDateYmd candidates efficiently.
    const scheduledItems: any[] = [];
    const gsiName = process.env.GSI_BY_POOL_DATE || 'GSI_ByPoolDate';
    const tryUseGsi = Boolean(process.env.GSI_BY_POOL_DATE || true);
    try {
      if (tryUseGsi) {
        // Query for today and tomorrow separately
        const dates = [];
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dates.push(yyyymmddJst(today));
        dates.push(yyyymmddJst(tomorrow));
        for (const ymd of dates) {
          try { console.info('[regenerate] tryingGSIQuery', { gsiName, poolType, ymd }); } catch(_) {}
          let exclusiveStartKey: any = undefined;
          do {
            const params: any = {
              TableName: TBL_SCHEDULED,
              IndexName: gsiName,
              KeyConditionExpression: 'poolType = :pool AND scheduledDateYmd = :ymd',
              ExpressionAttributeValues: { ':pool': { S: poolType }, ':ymd': { S: String(ymd) } },
              ProjectionExpression: 'PK, SK, scheduledPostId, accountId, timeRange, #st, content, poolType, scheduledAt, scheduledDateYmd',
              ExpressionAttributeNames: { '#st': 'status' },
              Limit: 200,
            };
            if (exclusiveStartKey) params.ExclusiveStartKey = exclusiveStartKey;
            const out: any = await ddb.send(new QueryCommand(params));
            const pageItems: any[] = (out as any).Items || [];
            try { console.info('[regenerate] gsiQueryPage', { gsiName, poolType, ymd, returned: (out as any).Count || pageItems.length }); } catch(_) {}
            if (pageItems.length) scheduledItems.push(...pageItems);
            exclusiveStartKey = (out as any).LastEvaluatedKey;
          } while (exclusiveStartKey);
        }
      }
    } catch (e) {
      // Fallback to scanning by PK if GSI query fails
      try { console.info('[regenerate] GSI query failed, falling back to PK query', String(e)); } catch(_) {}
      let exclusiveStartKey: any = undefined;
      const baseParams: any = {
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: "SCHEDULEDPOST#" } },
        ProjectionExpression: "PK, SK, scheduledPostId, accountId, timeRange, #st, content, poolType, scheduledAt, scheduledDateYmd",
        ExpressionAttributeNames: { "#st": "status" },
        Limit: 200,
      };
      do {
        const params: any = { ...baseParams };
        if (exclusiveStartKey) params.ExclusiveStartKey = exclusiveStartKey;
        const out: any = await ddb.send(new QueryCommand(params));
        const pageItems: any[] = (out as any).Items || [];
        try { console.info('[regenerate] pkQueryPage', { returned: (out as any).Count || pageItems.length }); } catch(_) {}
        if (pageItems.length) scheduledItems.push(...pageItems);
        exclusiveStartKey = (out as any).LastEvaluatedKey;
      } while (exclusiveStartKey);
    }
    // Compute JST-based today/tomorrow YMD and Date objects before inspecting items
    const jstNowMsForInspect = Date.now() + (9 * 3600 * 1000);
    const jstNow = new Date(jstNowMsForInspect);
    const today = new Date(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayYmd = yyyymmddJst(today);
    const tomorrowYmd = yyyymmddJst(tomorrow);
    // (sample inspection removed)
    for (let i = 0; i < Math.min(50, scheduledItems.length); i++) {
      const it = scheduledItems[i];
      try {
        const pool = it.poolType?.S || '';
        const status = it.status?.S || '';
        const content = it.content?.S || '';
        const aid = it.accountId?.S || '';
        const tr = it.timeRange?.S || '';
        const sk = it.SK?.S || '';
        const sat = Number(it.scheduledAt?.N || 0);
        let satYmd = '';
        // Use stored scheduledDateYmd only (JST date string). Do not compute from scheduledAt.
        if (it.scheduledDateYmd && it.scheduledDateYmd.S) {
          satYmd = it.scheduledDateYmd.S;
        }
        // (removed verbose satYmdSources log)
        let reason = 'include';
        if (pool !== poolType) reason = 'pool_mismatch';
        else if (status !== 'scheduled') reason = 'status_not_scheduled';
        else if (String(content || '').trim().length > 0) reason = 'content_not_empty';
        else if (satYmd !== todayYmd && satYmd !== tomorrowYmd) reason = 'ymd_outside';
        // (removed verbose itemInspect log)
      } catch (_) {}
    }
    // (sample inspection removed)
    // (todayYmd and tomorrowYmd already computed above for inspection)

    // existingMap keys: accountId|timeRange|ymd -> item
    const existingMap = new Map<string, any>();
    for (const it of scheduledItems) {
      try {
        const pool = it.poolType?.S || it.poolType?.S || '';
        const status = it.status?.S || '';
        const content = it.content?.S || '';
        const aid = it.accountId?.S || '';
        const tr = it.timeRange?.S || '';
        const sk = it.SK?.S || '';
        const sat = Number(it.scheduledAt?.N || 0);
        // Use stored scheduledDateYmd only (JST). If missing, skip the item.
        let satYmd = '';
        if (it.scheduledDateYmd && it.scheduledDateYmd.S) {
          satYmd = it.scheduledDateYmd.S;
        } else {
          // If no stored scheduledDateYmd, mark as excluded (no verbose log)
          continue;
        }
        // Determine reason for inclusion/exclusion explicitly
        let reason = 'include';
        if (!accountsSet.has(aid)) {
          reason = 'account_not_in_type';
        }
        if (reason === 'include') {
          if (status !== 'scheduled') reason = 'status_not_scheduled';
        }
        if (reason === 'include') {
          if (String(content || '').trim().length > 0) reason = 'content_not_empty';
        }
        if (reason === 'include') {
          if (satYmd !== todayYmd && satYmd !== tomorrowYmd) reason = 'ymd_outside';
        }
        if (reason !== 'include') {
          try { console.info('[regenerate] skipItem', { reason, aid, tr, sk, satYmd }); } catch(_) {}
          continue;
        }
        const key = `${aid}|${tr}|${satYmd}`;
        existingMap.set(key, { sk, it });
      } catch (_) {}
    }
    try { console.info('[regenerate] scheduledItemsFetched', { userId, totalScheduled: scheduledItems.length, existingCandidates: existingMap.size }); } catch(_) {}

    let deleted = 0;
    let created = 0;

    // Deletion: delete scheduled empty posts whose timeRange is OFF now
    for (const [key, val] of existingMap.entries()) {
      try {
        const [aid, tr, ymd] = key.split("|");
        let field = 'unknown';
        if (String(tr).startsWith('07')) field = 'morning';
        else if (String(tr).startsWith('12')) field = 'noon';
        else if (String(tr).startsWith('17')) field = 'night';
        const allowed = field === 'morning' ? morningOn : (field === 'noon' ? noonOn : (field === 'night' ? nightOn : false));
        if (!allowed) {
          try { console.info('[regenerate] deleting', { userId, accountId: aid, timeRange: tr, ymd, field }); } catch(_) {}
          // Delete item by PK/SK
          const sk = val.sk;
          await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: sk } } }));
          deleted++;
        }
      } catch (e) {
        // ignore individual failures
      }
    }

    // Generation: for each account and for today and tomorrow, create if ON and not exists
    for (const acc of accounts) {
      for (const dayInfo of [{ date: today, ymd: todayYmd, requireFuture: true }, { date: tomorrow, ymd: tomorrowYmd, requireFuture: false }]) {
        for (const w of fixedWindows) {
          try {
            let field = 'unknown';
            if (String(w).startsWith('07')) field = 'morning';
            else if (String(w).startsWith('12')) field = 'noon';
            else if (String(w).startsWith('17')) field = 'night';
            const allowed = field === 'morning' ? morningOn : (field === 'noon' ? noonOn : (field === 'night' ? nightOn : false));
            if (!allowed) continue;
            const when = randomTimeInRangeJst(w, dayInfo.date);
            if (!when) continue;
            const nowTs = Math.floor(Date.now() / 1000);
            const whenTs = Math.floor(when.getTime() / 1000);
            if (dayInfo.requireFuture && whenTs <= nowTs) continue; // only future windows for today
            const key = `${acc.accountId}|${w}|${dayInfo.ymd}`;
            if (existingMap.has(key)) continue; // exists
            const id = `xsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
            const scheduledAt = whenTs;
            const nowSec = Math.floor(Date.now() / 1000);
            const timeRangeNorm = String(w).replace(/[^0-9A-Za-z]/g, '_');
            const skId = `SCHEDULEDPOST#${acc.accountId}#${dayInfo.ymd}#${timeRangeNorm}`;
            const item: any = {
              PK: { S: `USER#${userId}` },
              SK: { S: skId },
              scheduledPostId: { S: id },
              accountId: { S: acc.accountId },
              accountName: { S: acc.displayName || acc.accountId },
              content: { S: '' },
              scheduledAt: { N: String(scheduledAt) },
              postedAt: { N: '0' },
              status: { S: 'scheduled' },
              timeRange: { S: w },
              scheduledSource: { S: 'pool' },
              poolType: { S: poolType },
              createdAt: { N: String(nowSec) },
              updatedAt: { N: String(nowSec) },
              scheduledDateYmd: { S: dayInfo.ymd },
            };
            try {
              try { console.info('[regenerate] creatingScheduledItem', { userId, skId, poolType, accountId: acc.accountId, ymd: dayInfo.ymd, timeRange: w }); } catch(_) {}
              await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item, ConditionExpression: 'attribute_not_exists(SK)' }));
              created++;
              try { console.info('[regenerate] createdScheduledItem', { userId, skId }); } catch(_) {}
            } catch (e:any) {
              try { console.info('[regenerate] createFailed', { err: String(e?.message || e), skId }); } catch(_) {}
              // conditional failed or other -> skip
            }
          } catch (e) {
            // skip per-window errors
          }
        }
      }
    }
    try { console.info('[regenerate] result', { userId, deleted, created }); } catch(_) {}
    return res.status(200).json({ ok: true, deleted, created });
  } catch (e: any) {
    console.error('[regenerate] error', String(e));
    return res.status(500).json({ error: 'internal_error', message: String(e?.message || e) });
  }
}


