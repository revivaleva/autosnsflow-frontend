import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
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
        return res.status(200).json({ ok: true, item: { morning, noon, night } });
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
      // Build item with provided values; keep unspecified fields as false if absent
      const now = Math.floor(Date.now() / 1000);
      const item: any = {
        user_id: { S: String(userId) },
        type: { S: String(type) },
        morning: { BOOL: Boolean(morning === true) },
        noon: { BOOL: Boolean(noon === true) },
        night: { BOOL: Boolean(night === true) },
        updated_at: { N: String(now) },
      };
      // Optionally set created_at if not exists — just put (overwrite) for simplicity
      item.created_at = { N: String(now) };

      try {
        await ddb.send(new PutItemCommand({ TableName: TBL, Item: item }));
        return res.status(200).json({ ok: true, item: { morning: Boolean(item.morning.BOOL), noon: Boolean(item.noon.BOOL), night: Boolean(item.night.BOOL) } });
      } catch (e: any) {
        if (e && (e.name === 'ResourceNotFoundException' || String(e).includes('Requested resource not found'))) {
          console.error('[user-type-time-settings] error: ResourceNotFoundException', String(e));
          return res.status(500).json({ error: "table_not_found", message: `DynamoDB テーブル '${TBL}' が見つかりません。環境変数 TBL_USER_TYPE_TIME_SETTINGS の設定とテーブルの存在を確認してください。` });
        }
        console.error('[user-type-time-settings] PutItem failed', String(e));
        return res.status(500).json({ error: "put_failed", message: String(e?.message || e) });
      }
    }

    res.setHeader("Allow", ["GET", "PATCH"]);
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e: any) {
    console.error("[user-type-time-settings] error:", e?.stack || e);
    return res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}


