#!/usr/bin/env node
// use global fetch (Node 18+)
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const userId = process.argv[2];
const accountId = process.argv[3];
if (!userId || !accountId) {
  console.error('Usage: node scripts/check-monitored-account.js <userId> <accountId>');
  process.exit(2);
}

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TABLE = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';

const ddb = new DynamoDBClient({ region: REGION });

async function getAccount() {
  const res = await ddb.send(new GetItemCommand({
    TableName: TABLE,
    Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
    ProjectionExpression: 'accessToken, oauthAccessToken, providerUserId, autoQuote, autoGenerate, autoPost, monitoredAccountId, quoteTimeStart, quoteTimeEnd'
  }));
  return res.Item || {};
}

function val(item, key) {
  if (!item || !item[key]) return null;
  if (item[key].S) return item[key].S;
  if (item[key].BOOL !== undefined) return item[key].BOOL;
  if (item[key].N) return item[key].N;
  return null;
}

async function fetchLatestPosts(token) {
  const fields = ['id','shortcode','timestamp','text','reply_to','referenced_posts','reply_count','user_id','root_id'];
  const url = `${BASE}/me/threads?limit=1&fields=${encodeURIComponent(fields.join(','))}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const txt = await r.text().catch(()=>'');
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  return { status: r.status, ok: r.ok, data };
}

async function run() {
  try {
    const item = await getAccount();
    console.log('Account item keys:', Object.keys(item));
    const accessToken = val(item, 'accessToken') || val(item, 'oauthAccessToken') || null;
    const providerUserId = val(item, 'providerUserId') || null;
    console.log({ accessTokenPresent: !!accessToken, providerUserId, autoQuote: val(item,'autoQuote'), autoGenerate: val(item,'autoGenerate'), autoPost: val(item,'autoPost'), monitoredAccountId: val(item,'monitoredAccountId'), quoteTimeStart: val(item,'quoteTimeStart'), quoteTimeEnd: val(item,'quoteTimeEnd') });

    if (!accessToken) {
      console.error('No access token available for account');
      process.exit(0);
    }

    const res = await fetchLatestPosts(accessToken);
    console.log('Threads API response status:', res.status, 'ok=', res.ok);
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error('Error', String(e));
    process.exit(1);
  }
}

run();


