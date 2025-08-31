import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_REPLIES = process.env.TBL_REPLIES || "Replies";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method Not Allowed' });
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const ids: string[] = [];
    if (body.replyId) ids.push(body.replyId);
    if (Array.isArray(body.replyIds)) ids.push(...body.replyIds);
    if (!ids.length) return res.status(400).json({ error: 'replyId or replyIds required' });

    const results: any[] = [];
    for (const id of ids) {
      try {
        const get = await ddb.send(new GetItemCommand({ TableName: TBL_REPLIES, Key: { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${id}` } }, ProjectionExpression: 'status, responsePostId, postId, accountId' }));
        const item = get.Item;
        if (!item) {
          results.push({ id, ok: false, error: 'not_found' });
          continue;
        }

        const status = item.status?.S || '';

        if (status !== 'replied') {
          // 未返信: 物理削除
          await ddb.send(new DeleteItemCommand({ TableName: TBL_REPLIES, Key: { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${id}` } } }));
          results.push({ id, ok: true, deleted: true });
          continue;
        }

        // 返信済: Threads 側削除 + 論理削除
        const postId = item.responsePostId?.S || item.postId?.S;
        const accountId = item.accountId?.S;
        if (!postId || !accountId) {
          // 情報不足で実API削除できない -> 論理削除のみ
          const now = Math.floor(Date.now() / 1000);
          await ddb.send(new UpdateItemCommand({ TableName: TBL_REPLIES, Key: { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${id}` } }, UpdateExpression: 'SET isDeleted = :d, deletedAt = :ts', ExpressionAttributeValues: { ':d': { BOOL: true }, ':ts': { N: String(now) } } }));
          results.push({ id, ok: true, deleted: false, reason: 'missing_post_or_account' });
          continue;
        }

        try {
          const { deleteThreadsPost } = await Promise.resolve(require('@/lib/threads-delete'));
          await deleteThreadsPost({ postId, accountId, userId });
        } catch (e: any) {
          console.error('bulk replies threads delete failed', e);
          // 削除失敗はログ化しつつ論理削除
          await ddb.send(new UpdateItemCommand({ TableName: TBL_REPLIES, Key: { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${id}` } }, UpdateExpression: 'SET deleteAttemptFailed = :t', ExpressionAttributeValues: { ':t': { BOOL: true } } }));
          results.push({ id, ok: false, error: 'threads_delete_failed' });
          continue;
        }

        // Threads 側削除成功 → 論理削除
        const now2 = Math.floor(Date.now() / 1000);
        await ddb.send(new UpdateItemCommand({ TableName: TBL_REPLIES, Key: { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${id}` } }, UpdateExpression: 'SET isDeleted = :d, deletedAt = :ts', ExpressionAttributeValues: { ':d': { BOOL: true }, ':ts': { N: String(now2) } } }));
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


