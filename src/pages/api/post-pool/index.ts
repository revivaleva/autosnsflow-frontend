import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import crypto from "crypto";

const ddb = createDynamoClient();
const TBL_POOL = process.env.TBL_POST_POOL || "PostPool";

function mapItem(it: any) {
  const getS = (k: string) => it?.[k]?.S ?? "";
  const getN = (k: string) => (typeof it?.[k]?.N === "string" ? Number(it[k].N) : undefined);
  const getB = (k: string) => it?.[k]?.BOOL === true;
  let poolId = getS("poolId");
  if (!poolId) {
    const sk = it?.SK?.S || "";
    if (sk.startsWith("POOL#")) poolId = sk.replace("POOL#", "");
  }
  return {
    poolId,
    type: getS("type"),
    content: getS("content"),
    images: getS("images") ? JSON.parse(getS("images")) : [],
    createdAt: getN("createdAt"),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await verifyUserFromRequest(req).catch(() => null);
  if (!user?.sub) return res.status(401).json({ error: "unauthorized" });
  const userId = user.sub;
  console.log(`[post-pool] request method=${req.method} user=${userId} query=${JSON.stringify(req.query)}`);

  try {
    if (req.method === "GET") {
      const qType = typeof req.query.type === "string" ? req.query.type : undefined;
      console.log(`[post-pool] GET start user=${userId} qType=${qType}`);
      // Query user's pool items and filter by type if provided
      const out = await ddb.send(new QueryCommand({
        TableName: TBL_POOL,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "POOL#" },
        },
        // ProjectionExpression omitted to keep full item
      }));
      const items = (out as any).Items || [];
      console.log(`[post-pool] GET raw items count=${(out as any).Count || items.length}`);
      const mapped = items.map(mapItem).filter((it: any) => !qType || it.type === qType);
      console.log(`[post-pool] GET mapped items count=${mapped.length}`);
      return res.status(200).json({ ok: true, items: mapped });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { type = "general", content = "", images = [] } = body;
      if (!content || String(content).trim().length === 0) {
        return res.status(400).json({ error: "content_required" });
      }
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const item: any = {
        PK: { S: `USER#${userId}` },
        SK: { S: `POOL#${id}` },
        poolId: { S: id },
        type: { S: String(type) },
        content: { S: String(content) },
        images: { S: JSON.stringify(images || []) },
        createdAt: { N: String(now) },
      };
      await ddb.send(new PutItemCommand({ TableName: TBL_POOL, Item: item }));
      console.log(`[post-pool] POST saved poolId=${id} user=${userId}`);
      return res.status(200).json({ ok: true, item: mapItem(item) });
    }

    if (req.method === "DELETE") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const poolId = body.poolId || req.query.poolId;
      if (!poolId) return res.status(400).json({ error: "poolId_required" });
      const key = { PK: { S: `USER#${userId}` }, SK: { S: `POOL#${poolId}` } };
      await ddb.send(new DeleteItemCommand({ TableName: TBL_POOL, Key: key }));
      console.log(`[post-pool] DELETE poolId=${poolId} user=${userId}`);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e: any) {
    console.error("[post-pool] error:", e?.stack || e);
    // In dev we return detailed message; in prod the message is still sent but stack is logged above.
    return res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}


