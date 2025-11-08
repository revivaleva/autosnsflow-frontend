import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_POOL = process.env.TBL_POST_POOL || "PostPool";

function mapItem(it: any) {
  const getS = (k: string) => it?.[k]?.S ?? "";
  const getN = (k: string) => (typeof it?.[k]?.N === "string" ? Number(it[k].N) : undefined);
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

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ error: "method_not_allowed" });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const type = body.type || "general";

    // Query up to a reasonable number of pool items and pick random
    const out = await ddb.send(new QueryCommand({
      TableName: TBL_POOL,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: "POOL#" },
      },
      Limit: 200,
    }));
    const items = (out as any).Items || [];
    const candidates = items.filter((it: any) => (it?.type?.S || "") === type);
    if (!candidates || candidates.length === 0) return res.status(404).json({ error: "no_pool_items" });

    // Try to atomically delete a randomly chosen candidate. If conditional delete fails, retry with others.
    const shuffled = candidates.sort(() => 0.5 - Math.random());
    for (const it of shuffled) {
      const poolId = it.poolId?.S || ((it.SK && it.SK.S) ? String(it.SK.S).replace(/^POOL#/, "") : null);
      if (!poolId) continue;
      const key = { PK: { S: `USER#${userId}` }, SK: { S: `POOL#${poolId}` } };
      try {
        // Attempt to delete the item; if someone else deleted it first this will throw ConditionalCheckFailed
        await ddb.send(new DeleteItemCommand({
          TableName: TBL_POOL,
          Key: key,
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
        }));
        // Success: return the claimed item
        return res.status(200).json({ ok: true, item: mapItem(it) });
      } catch (e: any) {
        // continue to next candidate
        continue;
      }
    }

    return res.status(409).json({ error: "concurrent_claim_failed" });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}


