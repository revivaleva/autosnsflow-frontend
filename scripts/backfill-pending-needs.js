#!/usr/bin/env node
const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const TABLE = process.env.TABLE_NAME || 'ScheduledPosts';

(async function main(){
  // debug removed
  let lastKey = undefined;
  let processed = 0;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey: lastKey,
      ProjectionExpression: 'PK,SK,accountId,content,postedAt,#st',
      ExpressionAttributeNames: { '#st': 'status' },
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
          // needs content: set needsContentAccount AND ensure nextGenerateAt exists (0)
          await ddb.send(new UpdateItemCommand({
            TableName: TABLE,
            Key: key,
            UpdateExpression: 'SET needsContentAccount = :acc, nextGenerateAt = if_not_exists(nextGenerateAt, :zero)',
            ExpressionAttributeValues: { ':acc': { S: accountId }, ':zero': { N: '0' } }
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
    // debug removed
  } while (lastKey);

  // debug removed
})().catch(e=>{console.error(e); process.exit(1)});
