#!/usr/bin/env node
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';

const userId = process.argv[2] || process.env.USER_ID;
if (!userId) {
  console.error('Usage: node scripts/list-posted.js <userId>');
  process.exit(2);
}

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TABLE = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';
const client = new DynamoDBClient({ region: REGION });

async function run() {
  const params = {
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' } },
    Limit: 1000,
  };
  const res = await client.send(new QueryCommand(params));
  const items = (res.Items || []).map(it => ({
    scheduledPostId: it.scheduledPostId?.S || (it.SK?.S||'').replace(/^SCHEDULEDPOST#/,''),
    accountId: it.accountId?.S || '',
    status: it.status?.S || '',
    type: it.type?.S || '',
    postId: it.postId?.S || '',
    postUrl: it.postUrl?.S || '',
    createdAt: it.createdAt?.N ? Number(it.createdAt.N) : undefined,
    postedAt: it.postedAt?.N ? Number(it.postedAt.N) : undefined,
  }));
  const posted = items.filter(i => i.status === 'posted' || i.postId);
  console.log(JSON.stringify({ userId, postedCount: posted.length, posted }, null, 2));
}

run().catch(e=>{ console.error('err',String(e)); process.exit(1) });


