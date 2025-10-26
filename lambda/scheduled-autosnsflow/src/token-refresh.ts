import { createDynamoClient } from '@/lib/ddb';
import { QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import fetch from 'node-fetch';

const ddb = createDynamoClient();
const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';

const REFRESH_THRESHOLD = Number(process.env.TOKEN_REFRESH_THRESHOLD_SEC || String(60 * 60 * 24));
const BATCH_SIZE = Number(process.env.TOKEN_REFRESH_BATCH_SIZE || '50');

export async function runTokenRefreshOnce() {
  const now = Math.floor(Date.now() / 1000);
  // Query accounts where oauthTokenExpiresAt is within threshold
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_X,
    IndexName: 'GSI_OAUTH_EXPIRES',
    KeyConditionExpression: 'authState = :as AND oauthTokenExpiresAt <= :th',
    ExpressionAttributeValues: { ':as': { S: 'authorized' }, ':th': { N: String(now + REFRESH_THRESHOLD) } },
    Limit: BATCH_SIZE,
  }));
  const items: any[] = (q as any).Items || [];
  for (const it of items) {
    const pk = it.PK?.S || '';
    const sk = it.SK?.S || '';
    const accountId = it.accountId?.S || '';
    const clientId = it.clientId?.S || '';
    const clientSecret = it.clientSecret?.S || '';
    const refreshToken = it.refreshToken?.S || '';
    if (!clientId || !clientSecret || !refreshToken) {
      // mark reauth_required if missing
      try { await ddb.send(new UpdateItemCommand({ TableName: TBL_X, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: 'SET authState = :r', ExpressionAttributeValues: { ':r': { S: 'reauth_required' } } })); } catch(_){}
      continue;
    }
    try {
      const tokenUrl = 'https://api.x.com/2/oauth2/token';
      const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken });
      const r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) {
        // failure handling: increment fail counter, on 3 -> reauth_required
        const fails = Number(it.refreshFailCount?.N || '0') + 1;
        const updates: any = { ':fails': { N: String(fails) } };
        let expr = 'SET refreshFailCount = :fails';
        if (fails >= 3) { expr += ', authState = :reauth'; updates[':reauth'] = { S: 'reauth_required' }; }
        try { await ddb.send(new UpdateItemCommand({ TableName: TBL_X, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: expr, ExpressionAttributeValues: updates })); } catch(_){}
        continue;
      }
      // success: save new tokens, reset fail count
      const at = String(j.access_token || '');
      const rt = String(j.refresh_token || refreshToken);
      const expiresIn = Number(j.expires_in || 0);
      const vals: any = { ':at': { S: at }, ':rt': { S: rt }, ':te': { N: String(Math.floor(Date.now()/1000) + expiresIn) }, ':now': { N: String(Math.floor(Date.now()/1000)) }, ':zero': { N: '0' } };
      await ddb.send(new UpdateItemCommand({ TableName: TBL_X, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: 'SET oauthAccessToken = :at, refreshToken = :rt, oauthTokenExpiresAt = :te, oauthSavedAt = :now, refreshFailCount = :zero', ExpressionAttributeValues: vals }));
    } catch (e) {
      // continue with next
      try { await ddb.send(new UpdateItemCommand({ TableName: TBL_X, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: 'SET refreshFailCount = if_not_exists(refreshFailCount, :zero) + :inc', ExpressionAttributeValues: { ':inc': { N: '1' }, ':zero': { N: '0' } } })); } catch(_){}
    }
  }
}


