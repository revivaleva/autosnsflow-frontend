import { createDynamoClient } from '@/lib/ddb';
import { PutItemCommand, QueryCommand, UpdateItemCommand, DeleteItemCommand, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { putLog } from '@/lib/logger';

const ddb = createDynamoClient();
const TBL = process.env.TBL_DELETION_QUEUE || 'DeletionQueue';

// Create a deletion queue entry for the given account
export async function createDeletionQueueEntry({ accountId, userId }: { accountId: string; userId: string }) {
  const now = Math.floor(Date.now() / 1000);
  const sk = `DELETION#${now}#${Math.random().toString(36).slice(2, 8)}`;
  const item: any = {
    PK: { S: `ACCOUNT#${accountId}` },
    SK: { S: sk },
    accountId: { S: accountId },
    userId: { S: userId },
    createdAt: { N: String(now) },
    last_processed_at: { N: '0' },
    processing: { BOOL: false },
    retry_count: { N: '0' },
  };
  await ddb.send(new PutItemCommand({ TableName: TBL, Item: item }));
  return { sk };
}

// Try to claim a queue item for processing by setting processing=true atomically
export async function claimQueueItem({ accountId, sk }: { accountId: string; sk: string }) {
  // set processing = true only if processing = false
  try {
    const now = Math.floor(Date.now() / 1000);
    await ddb.send(new UpdateItemCommand({
      TableName: TBL,
      Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } },
      UpdateExpression: 'SET processing = :t, last_processed_at = :now',
      ConditionExpression: 'attribute_not_exists(processing) OR processing = :f',
      ExpressionAttributeValues: { ':t': { BOOL: true }, ':f': { BOOL: false }, ':now': { N: String(now) } },
    }));
    return true;
  } catch (e) {
    // failed to claim
    return false;
  }
}

// Release a claimed queue item (set processing=false and optionally update last_processed_at)
export async function releaseQueueItem({ accountId, sk, lastProcessedAt }: { accountId: string; sk: string; lastProcessedAt?: number }) {
  const values: any = { ':f': { BOOL: false } };
  let expr = 'SET processing = :f';
  if (typeof lastProcessedAt === 'number') {
    expr += ', last_processed_at = :ts';
    values[':ts'] = { N: String(lastProcessedAt) };
  }
  await ddb.send(new UpdateItemCommand({ TableName: TBL, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } }, UpdateExpression: expr, ExpressionAttributeValues: values }));
}

// Delete a queue item after completion
export async function deleteQueueItem({ accountId, sk }: { accountId: string; sk: string }) {
  await ddb.send(new DeleteItemCommand({ TableName: TBL, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } } }));
}

// List queue items that are eligible for processing (last_processed_at == 0 or older than threshold)
export async function listDueQueueItems({ olderThanSeconds = 24 * 3600 }: { olderThanSeconds?: number }) {
  // For simplicity scan the table and filter in-memory. If the table grows large, replace with GSI/Query pattern.
  const out = await ddb.send(new ScanCommand({ TableName: TBL }));
  const now = Math.floor(Date.now() / 1000);
  const items = (out as any).Items || [];
  return items.filter((it: any) => {
    const processing = it.processing?.BOOL === true;
    const last = it.last_processed_at?.N ? Number(it.last_processed_at.N) : 0;
    return !processing && (last === 0 || now - last >= olderThanSeconds);
  }).map((it: any) => ({ accountId: it.accountId?.S, sk: it.SK?.S, userId: it.userId?.S, last_processed_at: it.last_processed_at?.N }));
}

// Get a single queue item
export async function getQueueItem({ accountId, sk }: { accountId: string; sk: string }) {
  try {
    const out = await ddb.send(new GetItemCommand({ TableName: TBL, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } } }));
    return out.Item || null;
  } catch (e) {
    await putLog({ accountId, action: 'deletion_queue', status: 'error', message: String((e as any)?.message || e) });
    return null;
  }
}

// Delete all queue items for an account (used when cancelling deletion)
export async function deleteAllQueueItemsForAccount({ accountId }: { accountId: string }) {
  try {
    const out = await ddb.send(new ScanCommand({ TableName: TBL, FilterExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': { S: `ACCOUNT#${accountId}` } } }));
    const items = (out as any).Items || [];
    for (const it of items) {
      const sk = it.SK?.S;
      if (sk) {
        await ddb.send(new DeleteItemCommand({ TableName: TBL, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } } }));
      }
    }
    return true;
  } catch (e) {
    // debug warn removed
    return false;
  }
}

export default {
  createDeletionQueueEntry,
  claimQueueItem,
  releaseQueueItem,
  deleteQueueItem,
  listDueQueueItems,
  getQueueItem,
  deleteAllQueueItemsForAccount,
};


