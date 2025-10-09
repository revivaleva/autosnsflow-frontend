import { createDynamoClient } from '@/lib/ddb';
import { ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import fetch from 'node-fetch';
import { putLog } from '@/lib/logger';

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const CLIENT_SECRET = process.env.THREADS_CLIENT_SECRET || '';
const CLIENT_ID = process.env.THREADS_CLIENT_ID || '';
const TOKEN_EXCHANGE_URL = process.env.THREADS_TOKEN_EXCHANGE_URL || 'https://graph.threads.net/access_token';
const THRESHOLD = Number(process.env.TOKEN_REFRESH_THRESHOLD_SEC || String(60 * 60 * 24));

export async function handler() {
  const now = Math.floor(Date.now() / 1000);
  let lastKey: any = undefined;
  do {
    const q = await ddb.send(new ScanCommand({ TableName: TBL, ProjectionExpression: 'PK,SK,oauthAccessToken,oauthAccessTokenExpiresAt', ExclusiveStartKey: lastKey, Limit: 100 }));
    const items = (q as any).Items || [];
    for (const it of items) {
      try {
        const pk = it.PK?.S || '';
        const sk = it.SK?.S || '';
        const accountId = it.accountId?.S || sk.replace(/^ACCOUNT#/, '');
        const expiresAt = it.oauthAccessTokenExpiresAt?.N ? Number(it.oauthAccessTokenExpiresAt.N) : 0;
        if (!expiresAt || (expiresAt - now) > THRESHOLD) continue;
        // attempt exchange
        try {
          const exchUrl = `${TOKEN_EXCHANGE_URL}?grant_type=th_exchange_token&client_secret=${encodeURIComponent(String(CLIENT_SECRET))}` + `&client_id=${encodeURIComponent(String(CLIENT_ID))}`;
          const resp = await fetch(exchUrl, { method: 'POST' });
          const json = await resp.json().catch(() => ({}));
          if (resp.ok && json?.access_token) {
            const newToken = String(json.access_token);
            const newExpires = Number(json.expires_in || 0) ? Math.floor(Date.now() / 1000) + Number(json.expires_in) : expiresAt;
            await ddb.send(new UpdateItemCommand({ TableName: TBL, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: 'SET oauthAccessToken = :t, oauthAccessTokenExpiresAt = :e', ExpressionAttributeValues: { ':t': { S: newToken }, ':e': { N: String(newExpires) } } }));
            await putLog({ userId: pk.replace(/^USER#/, ''), accountId, action: 'token_refresh', status: 'info', message: 'oauth_refresh_succeeded' });
            continue;
          } else {
            await putLog({ userId: pk.replace(/^USER#/, ''), accountId, action: 'token_refresh', status: 'error', message: 'oauth_refresh_failed', detail: { resp: json } });
            await ddb.send(new UpdateItemCommand({ TableName: TBL, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: 'SET #st = :s', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'reauth_required' } } }));
            continue;
          }
        } catch (e) {
          await putLog({ userId: pk.replace(/^USER#/, ''), accountId, action: 'token_refresh', status: 'error', message: 'oauth_refresh_error', detail: { error: String(e) } });
          try { await ddb.send(new UpdateItemCommand({ TableName: TBL, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: 'SET #st = :s', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'reauth_required' } } })); } catch(_) {}
        }
      } catch (e) { }
    }
    lastKey = (q as any).LastEvaluatedKey;
  } while (lastKey);
}

export default handler;


