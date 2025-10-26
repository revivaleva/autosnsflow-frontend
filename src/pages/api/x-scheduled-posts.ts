import type { NextApiRequest, NextApiResponse } from 'next';
import { QueryCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';

const ddb = createDynamoClient();
const TBL = process.env.TBL_X_SCHEDULED || 'XScheduledPosts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method === 'GET') {
      const scheduledPostId = typeof req.query.scheduledPostId === 'string' ? req.query.scheduledPostId : undefined;
      const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;

      if (scheduledPostId) {
        const out = await ddb.send(new GetItemCommand({ TableName: TBL, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } } }));
        const it: any = (out as any).Item;
        if (!it) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json({ scheduledPost: unmarshallScheduled(it) });
      }

      // list by user or by account
      if (accountId) {
        // Query GSI_ByAccount or filter client-side via Query on PK
        const q = await ddb.send(new QueryCommand({ TableName: TBL, IndexName: 'GSI_ByAccount', KeyConditionExpression: 'accountId = :acc', ExpressionAttributeValues: { ':acc': { S: accountId } } }));
        const items: any[] = (q as any).Items || [];
        return res.status(200).json({ scheduledPosts: items.map(unmarshallScheduled) });
      }

      const q = await ddb.send(new QueryCommand({ TableName: TBL, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' } } }));
      const items: any[] = (q as any).Items || [];
      return res.status(200).json({ scheduledPosts: items.map(unmarshallScheduled) });
    }

    if (req.method === 'POST') {
      const body = safeBody(req.body);
      try { console.log('[api/x-scheduled-posts] POST payload:', JSON.stringify(body)); } catch(_) {}
      const { scheduledPostId, accountId, content, scheduledAt } = body || {};
      if (!accountId || !content || (typeof scheduledAt === 'undefined' || scheduledAt === null || scheduledAt === '')) return res.status(400).json({ error: 'accountId, content, scheduledAt required' });
      const id = scheduledPostId || `sp-${Date.now().toString(36)}`;
      const now = `${Math.floor(Date.now() / 1000)}`;
      // normalize scheduledAt: accept numeric epoch (seconds) or 'YYYY-MM-DDTHH:mm' treated as JST
      const parsedScheduledAt = parseScheduledAtToEpochSec(scheduledAt);
      if (!parsedScheduledAt) return res.status(400).json({ error: 'invalid scheduledAt' });
      const item: any = {
        PK: { S: `USER#${userId}` },
        SK: { S: `SCHEDULEDPOST#${id}` },
        scheduledPostId: { S: id },
        accountId: { S: accountId },
        accountName: { S: body.accountName || '' },
        content: { S: String(content) },
        scheduledAt: { N: String(Math.floor(Number(parsedScheduledAt) || 0)) },
        postedAt: { N: '0' },
        status: { S: 'pending' },
        pendingForAutoPostAccount: { S: String(accountId) },
        createdAt: { N: now },
        updatedAt: { N: now },
      };
      try {
        await ddb.send(new PutItemCommand({ TableName: TBL, Item: item }));
        try { console.log('[api/x-scheduled-posts] POST success:', id); } catch(_) {}
        return res.status(201).json({ scheduledPostId: id });
      } catch (e) {
        console.error('[api/x-scheduled-posts] POST failed:', String(e));
        throw e;
      }
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = safeBody(req.body);
      try { console.log('[api/x-scheduled-posts] PATCH payload:', JSON.stringify(body)); } catch(_) {}
      const { scheduledPostId, content, scheduledAt, status } = body || {};
      if (!scheduledPostId) return res.status(400).json({ error: 'scheduledPostId required' });
      const sets: string[] = ['updatedAt = :ts'];
      const vals: any = { ':ts': { N: `${Math.floor(Date.now() / 1000)}` } };
      if (typeof content !== 'undefined') { sets.push('content = :content'); vals[':content'] = { S: String(content || '') }; }
      if (typeof scheduledAt !== 'undefined') { sets.push('scheduledAt = :scheduledAt'); vals[':scheduledAt'] = { N: String(Math.floor(Number(scheduledAt) || 0)) }; }
      if (typeof status !== 'undefined') { sets.push('status = :status'); vals[':status'] = { S: String(status || '') }; }
      if (sets.length === 1) return res.status(400).json({ error: 'no updatable fields' });
      try {
        await ddb.send(new UpdateItemCommand({ TableName: TBL, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeValues: vals }));
        try { console.log('[api/x-scheduled-posts] PATCH success:', scheduledPostId, sets); } catch(_) {}
        return res.status(200).json({ ok: true });
      } catch (e) {
        console.error('[api/x-scheduled-posts] PATCH failed:', String(e));
        throw e;
      }
    }

    if (req.method === 'DELETE') {
      const body = safeBody(req.body);
      const scheduledPostId = (typeof body?.scheduledPostId === 'string' && body.scheduledPostId) || (typeof req.query.scheduledPostId === 'string' ? req.query.scheduledPostId : '');
      if (!scheduledPostId) return res.status(400).json({ error: 'scheduledPostId required' });
      await ddb.send(new DeleteItemCommand({ TableName: TBL, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } } }));
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

function unmarshallScheduled(it: any) {
  return {
    scheduledPostId: it.scheduledPostId?.S || (it.SK?.S || '').replace(/^SCHEDULEDPOST#/, ''),
    accountId: it.accountId?.S || '',
    accountName: it.accountName?.S || '',
    content: it.content?.S || '',
    scheduledAt: it.scheduledAt?.N ? Number(it.scheduledAt.N) : 0,
    postedAt: it.postedAt?.N ? Number(it.postedAt.N) : 0,
    status: it.status?.S || '',
    postId: it.postId?.S || '',
    createdAt: it.createdAt?.N ? Number(it.createdAt.N) : 0,
    updatedAt: it.updatedAt?.N ? Number(it.updatedAt.N) : 0,
  };
}

// Parse scheduledAt input to epoch seconds (JST interpretation for YYYY-MM-DDTHH:mm without timezone)
function parseScheduledAtToEpochSec(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.floor(v);
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s.length > 10 ? Math.floor(Number(s) / 1000) : s);
  // match YYYY-MM-DDTHH:mm (no timezone) and treat as JST
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (m) {
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]), hour = Number(m[4]), minute = Number(m[5]);
    // JST -> UTC = JST - 9 hours
    const utcMs = Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
    return Math.floor(utcMs / 1000);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  return 0;
}


