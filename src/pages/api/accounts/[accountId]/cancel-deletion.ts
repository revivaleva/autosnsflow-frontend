import type { NextApiRequest, NextApiResponse } from 'next';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';
import { putLog } from '@/lib/logger';
import dq from '@/lib/deletion-queue';

const ddb = createDynamoClient();
const TBL_THREADS_ACCOUNTS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    const accountId = Array.isArray(req.query.accountId) ? req.query.accountId[0] : req.query.accountId;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    // debug log removed

    // delete queue items
    const ok = await dq.deleteAllQueueItemsForAccount({ accountId });
    if (!ok) {
      return res.status(500).json({ error: 'delete_queue_failed' });
    }

    // set account status to active
    try {
      await ddb.send(new (require('@aws-sdk/client-dynamodb').UpdateItemCommand)({
        TableName: TBL_THREADS_ACCOUNTS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: 'SET #st = :s',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':s': { S: 'active' } },
      }));
    } catch (e) {
      // debug warn removed
    }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    // debug error removed
    return res.status(500).json({ error: e?.message || 'internal_error' });
  }
}


