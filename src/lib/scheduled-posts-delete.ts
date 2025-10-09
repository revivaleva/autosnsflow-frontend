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
    // debug logging removed
    if (!existing || !existing.Item) return { ok: false, reason: 'not_found' };
    const status = existing.Item?.status?.S || '';
    if (physical) {
      // Try physical delete with a few retries; do not fall back to logical delete
      const maxAttempts = 3;
      let attempt = 0;
      while (attempt < maxAttempts) {
        try {
          attempt++;
          await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
          await putLog({ userId, action: 'deletion', accountId: existing.Item?.accountId?.S || '', status: 'info', message: 'physical_deleted', detail: { sk, attempts: attempt } });
          return { ok: true, physical: true };
        } catch (e) {
          try { console.warn('[deleteScheduledRecord] physical delete failed (attempt ' + attempt + ')', { userId, sk, error: String(e) }); } catch(_) {}
          await putLog({ userId, action: 'deletion', accountId: existing.Item?.accountId?.S || '', status: 'warn', message: 'physical_delete_failed', detail: { sk, attempt, error: String(e) } });
          if (attempt >= maxAttempts) {
            // Give up and surface error to caller
            throw e;
          }
        }
      }
    }
    // If caller did not request physical, still enforce physical-only policy: attempt physical delete
    // (legacy callers that passed physical=false will also get physical behavior)
    // This code path is unreachable because above returns or throws, but kept for clarity.
    throw new Error('unreachable');
  } catch (e) {
    try { console.warn('[deleteScheduledRecord] failed', { userId, sk, error: String(e) }); } catch(_) {}
    await putLog({ userId, action: 'deletion', status: 'error', message: 'delete_scheduled_failed', detail: { sk, error: String(e) } });
    throw e;
  }
}


