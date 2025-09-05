import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { deleteThreadsPost } from "@/lib/threads-delete";

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const ids: string[] = [];
    if (body.scheduledPostId) ids.push(body.scheduledPostId);
    if (Array.isArray(body.scheduledPostIds)) ids.push(...body.scheduledPostIds);
    if (!ids.length) return res.status(400).json({ error: 'scheduledPostId or scheduledPostIds required' });

    const results: any[] = [];
    for (const id of ids) {
      try {
        // 取得
        const get = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${id}` } } , ProjectionExpression: 'postId, numericPostId, accountId, status' }));
        const item = get.Item;
        const status = item?.status?.S || 'scheduled';
        if (status !== 'posted') {
          results.push({ id, ok: false, error: 'not_posted' });
          continue;
        }

        const postId = item?.postId?.S || item?.numericPostId?.S;
        const accountId = item?.accountId?.S;
        if (!postId || !accountId) {
          results.push({ id, ok: false, error: 'missing_post_or_account' });
          continue;
        }

        // 投稿済みでも実API削除は行わず、論理削除のみを行う
        const now = Math.floor(Date.now() / 1000);
        await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${id}` } }, UpdateExpression: 'SET isDeleted = :d, deletedAt = :ts', ExpressionAttributeValues: { ':d': { BOOL: true }, ':ts': { N: String(now) } } }));
        results.push({ id, ok: true, deleted: false });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.message || String(e) });
      }
    }

    return res.status(200).json({ results });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
  }
}


