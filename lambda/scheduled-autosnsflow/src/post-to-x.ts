import fetch from 'node-fetch';
import { createDynamoClient } from '@/lib/ddb';
import { PutItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL_X_SCHEDULED = process.env.TBL_X_SCHEDULED || 'XScheduledPosts';

export async function postToX({ accessToken, text }: { accessToken: string; text: string }) {
  const url = 'https://api.x.com/2/tweets';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`X post failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Fetch due X scheduled posts for an account (uses GSI_PendingByAccount)
export async function fetchDueXScheduledForAccount(accountId: string, nowSec: number, limit = 10) {
  try {
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_X_SCHEDULED,
      IndexName: 'GSI_PendingByAccount',
      KeyConditionExpression: 'pendingForAutoPostAccount = :acc AND scheduledAt <= :now',
      ExpressionAttributeValues: { ':acc': { S: accountId }, ':now': { N: String(nowSec) } },
      Limit: limit,
    }));
    return (q as any).Items || [];
  } catch (e) {
    throw e;
  }
}

// Mark scheduled item as posted (update postedAt/status/postId)
export async function markXScheduledPosted(pk: string, sk: string, postId: string) {
  const now = Math.floor(Date.now() / 1000);
  await ddb.send(new UpdateItemCommand({
    TableName: TBL_X_SCHEDULED,
    Key: { PK: { S: pk }, SK: { S: sk } },
    UpdateExpression: 'SET #st = :posted, postedAt = :ts, postId = :pid',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':posted': { S: 'posted' }, ':ts': { N: String(now) }, ':pid': { S: postId } },
  }));
}

// Skeleton runner to be invoked by the 5-min job per account
export async function runAutoPostForXAccount(acct: any, userId: string) {
  // acct must include oauthAccessToken (use refresh logic elsewhere)
  if (!acct || !acct.autoPostEnabled) return { posted: 0 };
  const now = Math.floor(Date.now() / 1000);
  const accountId = acct.accountId;

  const candidates = await fetchDueXScheduledForAccount(accountId, now, 5);
  let postedCount = 0;
  for (const it of candidates) {
    try {
      const pk = it.PK.S; const sk = it.SK.S;
      const content = it.content.S || '';
      // Prevent double-posting: ensure status is pending
      if ((it.status && it.status.S) && it.status.S !== 'pending') continue;
      const r = await postToX({ accessToken: acct.oauthAccessToken || acct.accessToken, text: content });
      const postId = (r && r.data && (r.data.id || r.data?.id_str)) || '';
      await markXScheduledPosted(pk, sk, String(postId));
      postedCount++;
    } catch (e) {
      // TODO: implement retries, logging, update status to 'failed'
    }
  }
  return { posted: postedCount };
}


