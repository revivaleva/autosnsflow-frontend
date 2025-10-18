import type { NextApiRequest, NextApiResponse } from 'next';
import { GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const { accountId } = req.query;
    if (!accountId || Array.isArray(accountId)) return res.status(400).json({ error: 'accountId required' });

    try {
      const out = await ddb.send(new GetItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${String(accountId)}` } },
        ProjectionExpression: 'oauthAccessToken, accessToken'
      }));
      const it: any = (out as any).Item || {};
      const oauthAccessToken = it.oauthAccessToken?.S || '';
      const accessToken = it.accessToken?.S || '';
      if (oauthAccessToken || accessToken) return res.status(200).json({ ok: true, oauthAccessToken, accessToken });

      // Fallback: try to locate by SK across users (debug helper)
      try {
        const q = await ddb.send(new QueryCommand({
          TableName: TBL,
          IndexName: 'GSI1',
          KeyConditionExpression: 'SK = :sk',
          ExpressionAttributeValues: { ':sk': { S: `ACCOUNT#${String(accountId)}` } },
          ProjectionExpression: 'PK, SK, oauthAccessToken, accessToken',
          Limit: 5,
        }));
        const items = (q as any).Items || [];
        if (items.length > 0) {
          const ret = items.map((it: any) => ({ PK: it.PK?.S || '', SK: it.SK?.S || '', oauthAccessToken: it.oauthAccessToken?.S || '', accessToken: it.accessToken?.S || '' }));
          return res.status(200).json({ ok: true, note: 'found_under_other_users', candidates: ret });
        }
      } catch (e) {
        // ignore
      }

      return res.status(200).json({ ok: true, oauthAccessToken: '', accessToken: '' });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'internal_error' });
    }
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
  }
}


