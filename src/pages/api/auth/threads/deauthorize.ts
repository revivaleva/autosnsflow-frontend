import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

// signed_request format: base64url(header).base64url(payload).signature
function base64UrlDecode(input: string) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const signed = req.body?.signed_request || (typeof req.body === 'string' ? (req.body as string) : undefined);
  if (!signed || typeof signed !== 'string') return res.status(400).json({ error: 'signed_request missing' });

  try {
    const parts = signed.split('.');
    if (parts.length !== 2 && parts.length !== 3) return res.status(400).json({ error: 'invalid_signed_request' });
    const payload = parts.length === 2 ? parts[1] : parts[1];
    const json = JSON.parse(base64UrlDecode(payload));

    // json should contain user_id and algorithm
    const userId = json.user_id || json.userId || json.id;
    if (!userId) return res.status(400).json({ error: 'no_user_id' });

    // Verify signature if App Secret is available
    const appSecret = process.env.THREADS_CLIENT_SECRET || process.env.THREADS_APP_SECRET || '';
    if (appSecret && parts.length >= 2) {
      const sig = parts[0];
      const expected = crypto.createHmac('sha256', appSecret).update(parts[1]).digest('base64');
      const expectedUrl = expected.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (sig !== expectedUrl) {
        console.log('[deauth] signed_request signature mismatch', { sig, expectedUrl });
        return res.status(400).json({ error: 'invalid_signature' });
      }
    }

    // Find account entries that match providerUserId/userId and clear accessToken
    // We assume providerUserId is stored in item.providerUserId or provider_user_id attr
    // Scan is expensive; instead try Query by prefix for user settings: iterate users might be required.
    // Simpler: try to find under USER#<userId> if present
    const key = { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${userId}` } };
    try {
      const get = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: key }));
      if (get.Item) {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_THREADS,
          Key: key,
          UpdateExpression: 'REMOVE accessToken'
        }));
        console.log('[deauth] token removed for', userId);
      } else {
        console.log('[deauth] no direct account item for', userId, '- no action');
      }
    } catch (e) {
      console.error('[deauth] cleanup error', e);
    }

    // Respond 200 to acknowledge
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('deauthorize error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
}


