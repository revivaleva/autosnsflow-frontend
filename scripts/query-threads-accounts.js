#!/usr/bin/env node
// Query ThreadsAccounts for a given user and print account metadata.
// Usage: node scripts/query-threads-accounts.js <userId>
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";

const userId = process.argv[2] || process.env.USER_ID;
if (!userId) {
  console.error("Usage: node scripts/query-threads-accounts.js <userId>");
  process.exit(2);
}

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const TABLE = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";

const client = new DynamoDBClient({ region: REGION });

function parseBoolField(it, key) {
  if (!it || !it[key]) return false;
  if (typeof it[key].BOOL !== 'undefined') return Boolean(it[key].BOOL);
  if (typeof it[key].S === 'string') {
    const s = it[key].S.toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

async function run() {
  try {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: `ACCOUNT#` },
      },
      Limit: 200,
    };

    const res = await client.send(new QueryCommand(params));
    const items = (res.Items || []).map((it) => {
      const sk = it.SK?.S || '';
      const accountId = it.accountId?.S || (sk.split('#')[1] || '');
      return {
        accountId,
        displayName: it.displayName?.S || '',
        accessTokenPresent: Boolean(it.accessToken?.S || it.oauthAccessToken?.S),
        autoQuote: parseBoolField(it, 'autoQuote'),
        monitoredAccountId: it.monitoredAccountId?.S || '',
        autoGenerate: parseBoolField(it, 'autoGenerate'),
        autoPost: parseBoolField(it, 'autoPost'),
        quoteTimeStart: it.quoteTimeStart?.S || '',
        quoteTimeEnd: it.quoteTimeEnd?.S || '',
      };
    });

    console.log(JSON.stringify({ userId, count: items.length, items }, null, 2));
  } catch (e) {
    console.error('Query failed:', String(e));
    process.exit(1);
  }
}

run();


