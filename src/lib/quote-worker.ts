import { createDynamoClient } from './ddb';
import { QueryCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import fetchThreadsPosts from './fetch-threads-posts';

const ddb = createDynamoClient();
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';

export async function runHourlyQuoteCreation(userId: string) {
  if (!userId) throw new Error('userId required');

  // Fetch all accounts for user
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_THREADS,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } },
  }));
  const items: any[] = (q as any).Items || [];

  for (const it of items) {
    try {
      const accountId = it.accountId?.S || '';
      const autoQuote = !!it.autoQuote?.BOOL;
      const monitored = it.monitoredAccountId?.S || '';
      if (!accountId || !monitored) continue;
      if (!autoQuote) continue; // skip if account not opted-in

      // fetch latest post for this account (limit 1)
      const posts = await fetchThreadsPosts({ userId, accountId, limit: 1 });
      if (!Array.isArray(posts) || posts.length === 0) continue;
      const p = posts[0];
      const sourcePostId = String(p.id || p.shortcode || '');
      if (!sourcePostId) continue;

      // Check if a scheduled post already references this sourcePostId
      const existsQ = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        FilterExpression: 'sourcePostId = :sp',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':sp': { S: sourcePostId } },
        Limit: 1,
      }));
      const existItems = (existsQ as any).Items || [];
      if (existItems.length > 0) continue; // already scheduled or posted

      // create scheduled reservation record (pending_quote)
      const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const now = Math.floor(Date.now() / 1000);
      const item: any = {
        PK: { S: `USER#${userId}` },
        SK: { S: `SCHEDULEDPOST#${id}` },
        scheduledPostId: { S: id },
        accountId: { S: accountId },
        accountName: { S: it.displayName?.S || '' },
        content: { S: '' },
        theme: { S: '引用投稿' },
        scheduledAt: { N: String(now) },
        postedAt: { N: '0' },
        status: { S: 'pending_quote' },
        isDeleted: { BOOL: false },
        createdAt: { N: String(now) },
        // marker for GSI (if needed)
        pendingForAutoPostAccount: { S: accountId },
        // quote metadata
        sourcePostId: { S: sourcePostId },
        sourcePostShortcode: { S: String(p.shortcode || '') },
        type: { S: 'quote' },
      };

      await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));
    } catch (e) {
      console.warn('[quote-worker] account processing failed', String(e));
    }
  }
}

export default runHourlyQuoteCreation;


