import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL = process.env.TBL_USER_TYPE_TIME_SETTINGS || "UserTypeTimeSettings";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await verifyUserFromRequest(req).catch(() => null);
  if (!user?.sub) return res.status(401).json({ error: "unauthorized" });
  const userId = user.sub;

  try {
    if (req.method === "GET") {
      const qType = typeof req.query.type === "string" ? req.query.type : undefined;
      if (!qType) return res.status(400).json({ error: "type_required" });
      // Try GetItem using (user_id, type) keys
      try {
        const out = await ddb.send(new GetItemCommand({
          TableName: TBL,
          Key: { user_id: { S: String(userId) }, type: { S: String(qType) } },
        }));
        const it = (out as any).Item || {};
        const morning = Boolean(it.morning && (it.morning.BOOL === true || String(it.morning.S) === "true"));
        const noon = Boolean(it.noon && (it.noon.BOOL === true || String(it.noon.S) === "true"));
        const night = Boolean(it.night && (it.night.BOOL === true || String(it.night.S) === "true"));
        const reuse = Boolean(it.reuse && (it.reuse.BOOL === true || String(it.reuse.S) === "true"));
        return res.status(200).json({ ok: true, item: { morning, noon, night, reuse } });
      } catch (e: any) {
        // Handle missing table error explicitly to help debugging
        if (e && (e.name === 'ResourceNotFoundException' || String(e).includes('Requested resource not found'))) {
          console.error('[user-type-time-settings] error: ResourceNotFoundException', String(e));
          return res.status(500).json({ error: "table_not_found", message: `DynamoDB テーブル '${TBL}' が見つかりません。環境変数 TBL_USER_TYPE_TIME_SETTINGS の設定とテーブルの存在を確認してください。` });
        }
        // If lookup fails for other reasons, return default all-off to avoid surprising the UI
        console.error('[user-type-time-settings] GetItem failed', String(e));
        return res.status(200).json({ ok: true, item: { morning: false, noon: false, night: false } });
      }
    }

    if (req.method === "PATCH") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { type, morning, noon, night } = body;
      if (!type) return res.status(400).json({ error: "type_required" });
      // Build UpdateExpression for only provided fields to avoid overwriting unspecified flags
      const now = Math.floor(Date.now() / 1000);
      const sets: string[] = [];
      const exprNames: Record<string, string> = {};
      const exprVals: Record<string, any> = { ':now': { N: String(now) } };
      let idx = 0;
      if (typeof morning !== 'undefined') {
        const name = `#m`;
        const val = `:m`;
        exprNames[name] = 'morning';
        exprVals[val] = { BOOL: Boolean(morning === true) };
        sets.push(`${name} = ${val}`);
      }
      if (typeof noon !== 'undefined') {
        const name = `#n`;
        const val = `:n`;
        exprNames[name] = 'noon';
        exprVals[val] = { BOOL: Boolean(noon === true) };
        sets.push(`${name} = ${val}`);
      }
      if (typeof night !== 'undefined') {
        const name = `#nt`;
        const val = `:nt`;
        exprNames[name] = 'night';
        exprVals[val] = { BOOL: Boolean(night === true) };
        sets.push(`${name} = ${val}`);
      }
      if (typeof body.reuse !== 'undefined') {
        const name = `#r`;
        const val = `:r`;
        exprNames[name] = 'reuse';
        exprVals[val] = { BOOL: Boolean(body.reuse === true) };
        sets.push(`${name} = ${val}`);
      }
      // always set updated_at
      sets.push('#updatedAt = :now');
      exprNames['#updatedAt'] = 'updated_at';

      if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });

      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL,
          Key: { user_id: { S: String(userId) }, type: { S: String(type) } },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprVals,
        }));
        // Return the updated values by fetching the item
        const out = await ddb.send(new GetItemCommand({ TableName: TBL, Key: { user_id: { S: String(userId) }, type: { S: String(type) } } }));
        const it = (out as any).Item || {};
        const morningRes = Boolean(it.morning && (it.morning.BOOL === true || String(it.morning.S) === "true"));
        const noonRes = Boolean(it.noon && (it.noon.BOOL === true || String(it.noon.S) === "true"));
        const nightRes = Boolean(it.night && (it.night.BOOL === true || String(it.night.S) === "true"));
        return res.status(200).json({ ok: true, item: { morning: morningRes, noon: noonRes, night: nightRes } });
      } catch (e: any) {
        if (e && (e.name === 'ResourceNotFoundException' || String(e).includes('Requested resource not found'))) {
          console.error('[user-type-time-settings] error: ResourceNotFoundException', String(e));
          return res.status(500).json({ error: "table_not_found", message: `DynamoDB テーブル '${TBL}' が見つかりません。環境変数 TBL_USER_TYPE_TIME_SETTINGS の設定とテーブルの存在を確認してください。` });
        }
        console.error('[user-type-time-settings] UpdateItem failed', String(e));
        return res.status(500).json({ error: "update_failed", message: String(e?.message || e) });
      }
    }

    res.setHeader("Allow", ["GET", "PATCH"]);
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e: any) {
    console.error("[user-type-time-settings] error:", e?.stack || e);
    return res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}


