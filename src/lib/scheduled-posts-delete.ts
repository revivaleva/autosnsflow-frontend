import { createDynamoClient } from '@/lib/ddb';
import { DeleteItemCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { putLog } from '@/lib/logger';

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED || 'ScheduledPosts';

export async function deleteScheduledRecord({ userId, sk, physical = true }: { userId: string; sk: string; physical?: boolean }) {
  if (!userId || !sk) throw new Error('userId and sk required');
  const key = { PK: { S: `USER#${userId}` }, SK: { S: String(sk) } };
  try {
    // confirm exists
    const existing = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
    try { console.info('[deleteScheduledRecord] existing item', { userId, sk, exists: !!existing?.Item, item: existing?.Item ? { accountId: existing.Item.accountId?.S, status: existing.Item.status?.S, isDeleted: existing.Item.isDeleted?.BOOL, postId: existing.Item.postId?.S || existing.Item.numericPostId?.S } : undefined }); } catch(_) {}
    if (!existing || !existing.Item) return { ok: false, reason: 'not_found' };
    const status = existing.Item?.status?.S || '';
    if (physical) {
      try {
        await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
        try { console.info('[deleteScheduledRecord] physical delete succeeded', { userId, sk }); } catch(_) {}
        await putLog({ userId, type: 'deletion', accountId: existing.Item?.accountId?.S || '', status: 'info', message: 'physical_deleted', detail: { sk } });
        return { ok: true, physical: true };
      } catch (e) {
        try { console.warn('[deleteScheduledRecord] physical delete failed', { userId, sk, error: String(e) }); } catch(_) {}
        await putLog({ userId, type: 'deletion', accountId: existing.Item?.accountId?.S || '', status: 'warn', message: 'physical_delete_failed', detail: { sk, error: String(e) } });
        // fallback to logical
      }
    }
    // logical delete
    const now = Math.floor(Date.now() / 1000);
    await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: key, UpdateExpression: 'SET isDeleted = :t, deletedAt = :ts', ExpressionAttributeValues: { ':t': { BOOL: true }, ':ts': { N: String(now) } } }));
    try { console.info('[deleteScheduledRecord] logical delete applied', { userId, sk, deletedAt: now }); } catch(_) {}
    await putLog({ userId, type: 'deletion', accountId: existing.Item?.accountId?.S || '', status: 'info', message: 'logical_deleted', detail: { sk, deletedAt: now } });
    return { ok: true, physical: false };
  } catch (e) {
    try { console.warn('[deleteScheduledRecord] failed', { userId, sk, error: String(e) }); } catch(_) {}
    await putLog({ userId, type: 'deletion', status: 'error', message: 'delete_scheduled_failed', detail: { sk, error: String(e) } });
    throw e;
  }
}


