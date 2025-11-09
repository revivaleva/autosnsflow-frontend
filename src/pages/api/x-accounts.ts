import type { NextApiRequest, NextApiResponse } from 'next';
import { QueryCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';
import { deletePostsForAccount } from '@/lib/delete-posts-for-account';

const ddb = createDynamoClient();
const TBL = process.env.TBL_X_ACCOUNTS || 'XAccounts';

const UPDATABLE_FIELDS = new Set([
  'username',
  'clientId',
  'clientSecret',
  'accessToken',
  'oauthAccessToken',
  'autoPostEnabled',
  'authState',
  'type',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method === 'GET') {
      const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
      if (accountId) {
        const out = await ddb.send(new GetItemCommand({ TableName: TBL, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
        const item: any = (out as any).Item;
        if (!item) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json({ account: unmarshallAccount(item) });
      }

      const q = await ddb.send(new QueryCommand({ TableName: TBL, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } } }));
      const items: any[] = (q as any).Items || [];
      const accounts = items.map(unmarshallAccountSummary);
      return res.status(200).json({ accounts });
    }

    if (req.method === 'POST') {
      const body = safeBody(req.body);
      try { console.log('[api/x-accounts] POST payload:', JSON.stringify(body)); } catch(_) {}
      const { accountId, username, clientId, clientSecret, accessToken = '', oauthAccessToken = '', autoPostEnabled = false } = body || {};
      if (!accountId || !username) return res.status(400).json({ error: 'accountId and username required' });

      const now = `${Math.floor(Date.now() / 1000)}`;
      const item: any = {
        PK: { S: `USER#${userId}` },
        SK: { S: `ACCOUNT#${accountId}` },
        accountId: { S: accountId },
        providerUserId: { S: accountId },
        username: { S: username },
        clientId: { S: String(clientId || '') },
        clientSecret: { S: String(clientSecret || '') },
        accessToken: { S: String(accessToken || '') },
        oauthAccessToken: { S: String(oauthAccessToken || '') },
        autoPostEnabled: { BOOL: !!autoPostEnabled },
        authState: { S: 'authorized' },
        // optional classification/type (general|ero|saikyou)
        ...(body.type ? { type: { S: String(body.type) } } : {}),
        createdAt: { N: now },
        updatedAt: { N: now },
      };

      try {
        await ddb.send(new PutItemCommand({ TableName: TBL, Item: item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' }));
        return res.status(201).json({ accountId });
      } catch (e: any) {
        console.error('[api/x-accounts] PutItem failed:', String(e), e?.stack || '');
        // bubble up a helpful error message but avoid leaking secrets
        const msg = (e && e.name === 'ConditionalCheckFailedException') ? 'account_exists' : (e?.message || 'db_error');
        return res.status(500).json({ error: msg });
      }
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = safeBody(req.body);
      try { console.log('[api/x-accounts] PATCH payload:', JSON.stringify(body)); } catch(_) {}
      const { accountId, ...rest } = body || {};
      if (!accountId) return res.status(400).json({ error: 'accountId required' });

      // Build UpdateExpression with safe attribute name placeholders to avoid reserved keyword issues
      const vals: any = { ':ts': { N: `${Math.floor(Date.now() / 1000)}` } };
      const nameMap: Record<string, string> = {};
      const sets: string[] = [];

      // updatedAt placeholder
      const updatedAtPlaceholder = '#updatedAt';
      nameMap[updatedAtPlaceholder] = 'updatedAt';
      sets.push(`${updatedAtPlaceholder} = :ts`);

      let fieldIndex = 0;
      Object.entries(rest).forEach(([k, v]) => {
        if (!UPDATABLE_FIELDS.has(k)) return;
        const ph = `:v${fieldIndex}`;
        const namePlaceholder = `#f${fieldIndex}`;
        nameMap[namePlaceholder] = k;
        sets.push(`${namePlaceholder} = ${ph}`);
        vals[ph] = typeof v === 'boolean' ? { BOOL: v } : { S: String(v ?? '') };
        fieldIndex++;
      });

      if (sets.length === 1) return res.status(400).json({ error: 'no updatable fields' });

      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeValues: vals,
          ExpressionAttributeNames: nameMap,
        }));
        try { console.log('[api/x-accounts] PATCH success:', { userId, accountId, updated: sets }); } catch(_) {}
        return res.status(200).json({ ok: true });
      } catch (e) {
        console.error('[api/x-accounts] PATCH failed:', String(e));
        throw e;
      }
    }

    if (req.method === 'DELETE') {
      const body = safeBody(req.body);
      const accountId = (typeof body?.accountId === 'string' && body.accountId) || (typeof req.query.accountId === 'string' ? req.query.accountId : '');
      if (!accountId) return res.status(400).json({ error: 'accountId required' });

      // remove scheduled posts for account first
      try {
        await deletePostsForAccount({ userId, accountId, limit: 100 });
      } catch (e) {
        // log but continue to delete account record
      }

      await ddb.send(new DeleteItemCommand({ TableName: TBL, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
      return res.status(200).json({ deleted: true });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === 'Unauthorized' ? 401 : 500);
    return res.status(code).json({ error: e?.message || 'internal_error' });
  }
}

function safeBody(b: any) {
  try { return typeof b === 'string' ? JSON.parse(b) : (b || {}); }
  catch { return {}; }
}

function unmarshallAccountSummary(it: any) {
  return {
    accountId: it.accountId?.S || (it.SK?.S || '').replace(/^ACCOUNT#/, ''),
    username: it.username?.S || '',
    createdAt: it.createdAt?.N ? Number(it.createdAt.N) : 0,
    updatedAt: it.updatedAt?.N ? Number(it.updatedAt.N) : 0,
    autoPostEnabled: it.autoPostEnabled?.BOOL === true,
    authState: it.authState?.S || '',
    hasClientSecret: !!(it.clientSecret && it.clientSecret.S),
    // classification/type if present
    type: it.type?.S || 'general',
    // cumulative failure count (number)
    failureCount: it.failureCount?.N ? Number(it.failureCount.N) : 0,
  };
}

function unmarshallAccount(it: any) {
  return {
    accountId: it.accountId?.S || (it.SK?.S || '').replace(/^ACCOUNT#/, ''),
    providerUserId: it.providerUserId?.S || '',
    username: it.username?.S || '',
    clientId: it.clientId?.S || '',
    hasClientSecret: !!(it.clientSecret && it.clientSecret.S),
    accessToken: it.accessToken?.S || '',
    oauthAccessToken: it.oauthAccessToken?.S || '',
    autoPostEnabled: it.autoPostEnabled?.BOOL === true,
    authState: it.authState?.S || '',
    createdAt: it.createdAt?.N ? Number(it.createdAt.N) : 0,
    updatedAt: it.updatedAt?.N ? Number(it.updatedAt.N) : 0,
    // include optional fields
    type: it.type?.S || 'general',
    failureCount: it.failureCount?.N ? Number(it.failureCount.N) : 0,
  };
}


