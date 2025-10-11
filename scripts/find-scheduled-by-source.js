#!/usr/bin/env node
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';

const userId = process.argv[2];
const source = process.argv[3];
if (!userId || !source) {
  console.error('Usage: node scripts/find-scheduled-by-source.js <userId> <sourcePostId|shortcode>');
  process.exit(2);
}

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TABLE = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';
const client = new DynamoDBClient({ region: REGION });

async function run() {
  try {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' } },
      Limit: 1000,
    };
    const res = await client.send(new QueryCommand(params));
    const items = (res.Items || []).map(it => ({
      SK: it.SK?.S,
      scheduledPostId: it.scheduledPostId?.S || (it.SK?.S || '').replace(/^SCHEDULEDPOST#/, ''),
      status: it.status?.S || '',
      type: it.type?.S || '',
      sourcePostId: it.sourcePostId?.S || '',
      sourcePostShortcode: it.sourcePostShortcode?.S || '',
      postId: it.postId?.S || '',
      postUrl: it.postUrl?.S || '',
    }));

    const matches = items.filter(i => i.sourcePostId === source || i.sourcePostShortcode === source);
    console.log(JSON.stringify({ userId, source, count: matches.length, matches }, null, 2));
  } catch (e) {
    console.error('Query failed:', String(e));
    process.exit(1);
  }
}

run();


