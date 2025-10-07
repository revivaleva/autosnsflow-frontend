import { createDynamoClient } from '@/lib/ddb';
import { QueryCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED || 'ScheduledPosts';

export async function fetchUserPosts({ userId, accountId, limit = 100 }: { userId: string; accountId?: string; limit?: number }) {
  if (!userId) throw new Error('userId required');

  const q = await ddb.send(new QueryCommand({
    TableName: TBL_SCHEDULED,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}` },
      ':pfx': { S: 'SCHEDULEDPOST#' },
    },
  }));

  const items: any[] = (q as any).Items || [];
  const posts = items
    .map((it) => ({
      scheduledPostId: it.scheduledPostId?.S || (it.SK?.S || '').replace(/^SCHEDULEDPOST#/, ''),
      sk: it.SK?.S,
      postId: it.postId?.S || it.numericPostId?.S || '',
      accountId: it.accountId?.S || '',
      createdAt: it.createdAt?.N ? Number(it.createdAt.N) : 0,
      status: it.status?.S || '',
      isDeleted: it.isDeleted?.BOOL === true,
      raw: it,
    }))
    .filter((p) => p.postId && p.status === 'posted' && !p.isDeleted && (!accountId || p.accountId === accountId))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  return posts.slice(0, limit).map((p) => ({ scheduledPostId: p.scheduledPostId, postId: p.postId, accountId: p.accountId, createdAt: p.createdAt }));
}

export default fetchUserPosts;


