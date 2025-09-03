import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, GetItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const ids: string[] = [];
    if (body.scheduledPostId) ids.push(body.scheduledPostId);
    if (Array.isArray(body.scheduledPostIds)) ids.push(...body.scheduledPostIds);
    if (!ids.length) return res.status(400).json({ error: "scheduledPostId or scheduledPostIds required" });

    const results: any[] = [];
    for (const id of ids) {
      try {
        const get = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${id}` } }, ProjectionExpression: "status" }));
        const status = get.Item?.status?.S || "scheduled";
        if (status === "posted") {
          results.push({ id, ok: false, error: "posted" });
          continue;
        }
        await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${id}` } } }));
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.message || String(e) });
      }
    }

    return res.status(200).json({ results });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || "internal_error" });
  }
}


