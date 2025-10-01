import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

export async function deleteThreadsPost({ postId, accountId, userId }: { postId: string; accountId: string; userId: string }) {
  if (!postId) throw new Error('postId required');
  if (!accountId) throw new Error('accountId required');
  if (!userId) throw new Error('userId required');

  // Read tokens from DynamoDB
  const get = await ddb.send(new GetItemCommand({ TableName: TBL, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: 'accessToken, oauthAccessToken' }));
  const accessToken = get.Item?.accessToken?.S;
  const oauthAccessToken = get.Item?.oauthAccessToken?.S;
  // prefer oauthAccessToken if present
  const token = (oauthAccessToken && String(oauthAccessToken).trim()) ? oauthAccessToken : accessToken;

  if (!token) throw new Error('missing_access_token');

  const base = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';
  const url = `${base}/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(token)}`;

  const resp = await fetch(url, { method: 'DELETE' } as any);
  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    throw new Error(`threads_delete_failed: ${resp.status} ${text}`);
  }
  return true;
}


