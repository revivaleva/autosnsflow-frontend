#!/usr/bin/env node
const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const TABLE = process.env.TABLE_NAME || 'ScheduledPosts';

(async function main(){
  console.log('Starting backfill for', TABLE);
  let lastKey = undefined;
  let processed = 0;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey: lastKey,
      ProjectionExpression: 'PK,SK,accountId,content,postedAt,status',
      Limit: 100
    }));

    for (const it of (res.Items || [])) {
      processed++;
      const accountId = it.accountId?.S;
      if (!accountId) continue;
      const content = it.content?.S || '';
      const postedAt = Number(it.postedAt?.N || 0);
      const status = it.status?.S || '';
      const key = { PK: it.PK, SK: it.SK };

      try {
        if (!content || String(content).trim() === '') {
          // needs content
          await ddb.send(new UpdateItemCommand({
            TableName: TABLE,
            Key: key,
            UpdateExpression: 'SET needsContentAccount = :acc',
            ExpressionAttributeValues: { ':acc': { S: accountId } }
          }));
        } else if (postedAt === 0 && status === 'scheduled') {
          await ddb.send(new UpdateItemCommand({
            TableName: TABLE,
            Key: key,
            UpdateExpression: 'SET pendingForAutoPostAccount = :acc',
            ExpressionAttributeValues: { ':acc': { S: accountId } }
          }));
        }
      } catch (e) {
        console.error('update failed for', key, e);
      }
    }

    lastKey = res.LastEvaluatedKey;
    console.log('Processed so far', processed, 'LastKey:', !!lastKey);
  } while (lastKey);

  console.log('Done. Total processed:', processed);
})().catch(e=>{console.error(e); process.exit(1)});
