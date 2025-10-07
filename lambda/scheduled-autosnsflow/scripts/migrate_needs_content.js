#!/usr/bin/env node
// Usage: node migrate_needs_content.js [--accountId ACCOUNT_ID] [--table TABLE]
// This script scans ScheduledPosts and for items with empty or missing `content` sets `needsContentAccount = accountId`.

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import minimist from 'minimist';

const region = process.env.AWS_REGION || 'ap-northeast-1';
const TABLE = process.env.SCHEDULED_POSTS_TABLE || 'ScheduledPosts';

const argv = minimist(process.argv.slice(2));
const accountFilter = argv.accountId || argv.account || null;

const ddb = new DynamoDBClient({ region });

async function run() {
  // debug removed
  let scanned = 0;
  let updated = 0;
  let lastKey = undefined;
  const pfx = 'SCHEDULEDPOST#';

  do {
    const params = {
      TableName: TABLE,
      ProjectionExpression: 'PK, SK, accountId, content, isDeleted',
      FilterExpression: "begins_with(SK, :pfx) AND (attribute_not_exists(content) OR content = :empty) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)",
      ExpressionAttributeValues: {
        ':pfx': { S: pfx },
        ':empty': { S: '' },
        ':f': { BOOL: false }
      },
      Limit: 200,
      ExclusiveStartKey: lastKey
    };
    if (accountFilter) {
      // add accountId filter
      params.FilterExpression = params.FilterExpression + ' AND accountId = :acc';
      params.ExpressionAttributeValues[':acc'] = { S: accountFilter };
    }

    const res = await ddb.send(new ScanCommand(params));
    const items = res.Items || [];
    scanned += items.length;
    // debug removed

    for (const it of items) {
      try {
        const obj = unmarshall(it);
        const pk = it.PK?.S || obj.PK || '';
        const sk = it.SK?.S || obj.SK || '';
        const accountId = obj.accountId || (it.accountId && it.accountId.S) || null;
        if (!accountId) {
          // debug removed
          continue;
        }

        // Set needsContentAccount to accountId
        await ddb.send(new UpdateItemCommand({
          TableName: TABLE,
          Key: { PK: { S: pk }, SK: { S: sk } },
          // set needsContentAccount and ensure nextGenerateAt exists (0) so item is indexed by NeedsContentByNextGen
          UpdateExpression: 'SET needsContentAccount = :acc, nextGenerateAt = if_not_exists(nextGenerateAt, :zero)',
          ExpressionAttributeValues: { ':acc': { S: String(accountId) }, ':zero': { N: '0' } }
        }));
        updated++;
        // debug removed
      } catch (e) {
        console.error('update error', String(e));
      }
    }

    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  // debug removed
}

run().catch(e => { console.error('fatal', String(e)); process.exit(1); });


