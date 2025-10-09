import type { NextApiRequest, NextApiResponse } from 'next';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';
import { getThreadsPermalink } from '@/lib/threads';

const ddb = createDynamoClient();
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const { accountId, postId } = req.body || {};
    if (!accountId || !postId) return res.status(400).json({ error: 'accountId and postId required' });

    const acct = await ddb.send(new GetItemCommand({
      TableName: TBL_THREADS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
      ProjectionExpression: 'accessToken, oauthAccessToken'
    }));
    const accessToken = acct.Item?.accessToken?.S || '';
    const oauthAccessToken = acct.Item?.oauthAccessToken?.S || '';
    const token = (oauthAccessToken && oauthAccessToken.trim()) ? oauthAccessToken : accessToken;
    if (!token) return res.status(400).json({ error: 'missing_token' });

    try {
      const perm = await getThreadsPermalink({ accessToken: token, postId });
      if (!perm || !perm.url) {
        // indicate failure by returning null; caller should write '-' to postUrl to avoid retries
        return res.status(200).json({ url: null });
      }
      return res.status(200).json({ url: perm.url });
    } catch (e: any) {
      return res.status(200).json({ url: null });
    }
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
  }
}


