import { createDynamoClient } from '@/lib/ddb';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const LOG_TBL = process.env.LOG_TBL || 'AppLogs';

function ymd(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export async function logEvent(type: string, detail: any = {}) {
  try {
    const now = new Date();
    const item = {
      PK: { S: `LOG#${ymd(now)}` },
      SK: { S: `${now.toISOString()}#${type}` },
      type: { S: type },
      detail: { S: JSON.stringify(detail).slice(0, 35000) },
      ts: { N: String(Math.floor(now.getTime() / 1000)) },
    } as Record<string, any>;
    await ddb.send(new PutItemCommand({ TableName: LOG_TBL, Item: item }));
  } catch (e) {
    // never throw from logger
    console.log('[logEvent] failed', String(e));
  }
}


