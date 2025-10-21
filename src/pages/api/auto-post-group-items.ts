// /src/pages/api/auto-post-group-items.ts
// 可変スロット(最大10)のCRUD API
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_GROUPS = process.env.TBL_AUTO_POST_GROUPS || "AutoPostGroups";
const MAX_SLOTS = 10;

function skItem(groupKey: string, slotId: string) {
  return `GROUPITEM#${groupKey}#${slotId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method === "GET") {
      const groupKey = String(req.query.groupKey || "");
      if (!groupKey) return res.status(400).json({ error: "groupKey required" });
      const out = await ddb.send(new QueryCommand({
        TableName: TBL_GROUPS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: `GROUPITEM#${groupKey}#` } },
        ScanIndexForward: true,
        Limit: 100,
        ConsistentRead: true,
      }));
      const items = (out.Items || []).map((i: any) => ({
        slotId: (i.SK?.S || "").split(`#`).pop() || "",
        order: i.order?.N ? Number(i.order.N) : 0,
        timeRange: i.timeRange?.S || "",
        theme: i.theme?.S || "",
        enabled: i.enabled?.BOOL === true,
        secondStageWanted: i.secondStageWanted?.BOOL === true,
      })).sort((a, b) => a.order - b.order);
      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { groupKey, slotId, timeRange = "", theme = "", order = 0, enabled = true } = body || {};
      if (!groupKey || !slotId) return res.status(400).json({ error: "groupKey and slotId required" });
      // 上限チェック
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_GROUPS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: `GROUPITEM#${groupKey}#` } },
        Select: "COUNT",
      }));
      const count = Number(q.Count || 0);
      if (count >= MAX_SLOTS) return res.status(400).json({ error: "slot_limit_reached" });
      const sk = skItem(groupKey, slotId);
      console.log(`[auto-post-group-items][POST] user=${userId} groupKey=${groupKey} slotId=${slotId} SK=${sk}`);
      await ddb.send(new PutItemCommand({
        TableName: TBL_GROUPS,
        Item: {
          PK: { S: `USER#${userId}` },
          SK: { S: sk },
          order: { N: String(order) },
          timeRange: { S: String(timeRange || "") },
          theme: { S: String(theme || "") },
          enabled: { BOOL: !!enabled },
          secondStageWanted: { BOOL: !!(body.secondStageWanted) },
          createdAt: { N: String(Math.floor(Date.now() / 1000)) },
        },
      }));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "PATCH") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { groupKey, slotId, timeRange, theme, order, enabled } = body || {};
      if (!groupKey || !slotId) return res.status(400).json({ error: "groupKey and slotId required" });
      const names: Record<string, string> = {}; const values: Record<string, any> = {}; const sets: string[] = [];
      const has = (v: any) => typeof v !== "undefined";
      if (has(timeRange)) { names["#tr"] = "timeRange"; values[":tr"] = { S: String(timeRange || "") }; sets.push("#tr = :tr"); }
      if (has(theme))     { names["#th"] = "theme";     values[":th"] = { S: String(theme || "") };     sets.push("#th = :th"); }
      if (has(order))     { names["#od"] = "order";     values[":od"] = { N: String(Number(order) || 0) }; sets.push("#od = :od"); }
      if (has(enabled))   { names["#en"] = "enabled";   values[":en"] = { BOOL: !!enabled };               sets.push("#en = :en"); }
      if (has(body.secondStageWanted)) { names["#ssw"] = "secondStageWanted"; values[":ssw"] = { BOOL: !!body.secondStageWanted }; sets.push("#ssw = :ssw"); }
      if (!sets.length) return res.status(400).json({ error: "no_fields" });
      const sku = skItem(groupKey, slotId);
      console.log(`[auto-post-group-items][PATCH] user=${userId} groupKey=${groupKey} slotId=${slotId} SK=${sku} sets=${sets.join(',')}`);
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_GROUPS,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: sku } },
          UpdateExpression: "SET " + sets.join(", "),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
        }));
        return res.status(200).json({ ok: true });
      } catch (e: any) {
        // If conditional check failed, the item does not exist -> return 404 to client
        if (String(e?.name || e?.code || '').includes('ConditionalCheckFailed')) {
          return res.status(404).json({ error: 'not_found' });
        }
        console.error('[auto-post-group-items][PATCH] error', e);
        return res.status(500).json({ error: String(e?.message || e) });
      }
    }

    if (req.method === "DELETE") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { groupKey, slotId } = body || {};
      if (!groupKey || !slotId) return res.status(400).json({ error: "groupKey and slotId required" });
      const sk = skItem(groupKey, slotId);
      try {
        console.log(`[auto-post-group-items][DELETE] user=${userId} groupKey=${groupKey} slotId=${slotId} SK=${sk}`);
        await ddb.send(new DeleteItemCommand({
          TableName: TBL_GROUPS,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: sk } },
        }));
        return res.status(200).json({ ok: true, deleted: { PK: `USER#${userId}`, SK: sk } });
      } catch (e: any) {
        console.error('[auto-post-group-items][DELETE] error', e);
        return res.status(500).json({ error: String(e?.message || e) });
      }
    }

    res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}


