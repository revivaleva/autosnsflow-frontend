import type { NextApiRequest, NextApiResponse } from 'next';
import { GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';
import { getThreadsPermalink } from '@/lib/threads';

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const { scheduledPostId } = req.body || {};
    if (!scheduledPostId) return res.status(400).json({ error: 'scheduledPostId required' });

    const got = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } } }));
    const it = got.Item;
    if (!it) return res.status(404).json({ error: 'not_found' });
    const accountId = it.accountId?.S || '';
    const postId = it.postId?.S || '';
    const curUrl = it.postUrl?.S || '';
    if (!accountId || !postId) return res.status(400).json({ error: 'missing_account_or_postId' });
    // If already marked failed ('-') or already has url, skip
    if (curUrl === '-' || (curUrl && curUrl.trim().length > 0)) return res.status(200).json({ ok: true, url: curUrl || null });

    // fetch account tokens
    const acc = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: 'accessToken, oauthAccessToken' }));
    const accessToken = acc.Item?.accessToken?.S || '';
    const oauthAccessToken = acc.Item?.oauthAccessToken?.S || '';
    const token = (oauthAccessToken && oauthAccessToken.trim()) ? oauthAccessToken : accessToken;
    if (!token) {
      // mark as failed so we don't retry
      await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: 'SET postUrl = :p', ExpressionAttributeValues: { ':p': { S: '-' } } }));
      return res.status(200).json({ ok: false, url: null });
    }

    try {
      const perm = await getThreadsPermalink({ accessToken: token, postId });
      if (!perm || !perm.url) {
        await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: 'SET postUrl = :p', ExpressionAttributeValues: { ':p': { S: '-' } } }));
        return res.status(200).json({ ok: false, url: null });
      }
      await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: 'SET postUrl = :p', ExpressionAttributeValues: { ':p': { S: perm.url } } }));
      return res.status(200).json({ ok: true, url: perm.url });
    } catch (e) {
      await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: 'SET postUrl = :p', ExpressionAttributeValues: { ':p': { S: '-' } } }));
      return res.status(200).json({ ok: false, url: null });
    }
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
  }
}


