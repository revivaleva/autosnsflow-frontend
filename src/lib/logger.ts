import { createDynamoClient } from '@/lib/ddb';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
// Prefer explicit execution logs table used by scheduled tasks, fallback to LOG_TBL or ExecutionLogs
const LOG_TBL = process.env.TBL_EXECUTION_LOGS || process.env.LOG_TBL || 'ExecutionLogs';

function ymd(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export async function logEvent(type: string, detail: any = {}) {
  try {
    const now = new Date();
    // Support existing ExecutionLogs schema where PK is USER#<userId>
    const userId = detail?.userId || detail?.user || undefined;
    const accountId = detail?.accountId || '';
    const targetId = detail?.targetId || '';
    const status = detail?.status || 'info';
    const message = detail?.message || '';

    const item: Record<string, any> = {
      PK: { S: userId ? `USER#${userId}` : `LOG#${ymd(now)}` },
      SK: { S: `${now.toISOString()}#${type}` },
      type: { S: type },
      createdAt: { N: String(Math.floor(now.getTime() / 1000)) },
      status: { S: status },
      message: { S: String(message || '') },
      detail: { S: JSON.stringify(detail || {}).slice(0, 35000) },
    };

    if (accountId) item.accountId = { S: String(accountId) };
    if (targetId) item.targetId = { S: String(targetId) };

    await ddb.send(new PutItemCommand({ TableName: LOG_TBL, Item: item }));
  } catch (e) {
    // never throw from logger
    console.log('[logEvent] failed', String(e));
  }
}


