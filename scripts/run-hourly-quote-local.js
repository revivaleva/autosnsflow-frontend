#!/usr/bin/env node
/**
 * Minimal local runner that mimics runHourlyQuoteCreation for a single user.
 * Usage: node scripts/run-hourly-quote-local.js <userId>
 */
// use global fetch available in Node 18+
import { DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

const userId = process.argv[2] || process.env.USER_ID;
if (!userId) {
  console.error('Usage: node scripts/run-hourly-quote-local.js <userId>');
  process.exit(2);
}

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';
const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';

const ddb = new DynamoDBClient({ region: REGION });

async function queryAccounts() {
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_THREADS,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } },
  }));
  return q.Items || [];
}

function getS(it, key){ return it[key]?.S || '' }
function getB(it, key){ return it[key]?.BOOL }

async function fetchLatestForToken(token, limit=1){
  const fields = ['id','shortcode','timestamp','text','reply_to','referenced_posts','reply_count','user_id','root_id'];
  const url = `${BASE}/me/threads?limit=${limit}&fields=${encodeURIComponent(fields.join(','))}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const txt = await r.text().catch(()=>'');
  try{ const data = txt?JSON.parse(txt):{}; return { ok: r.ok, status: r.status, data }; }catch(e){ return { ok: r.ok, status: r.status, data: { raw: txt } } }
}

async function existsScheduledFor(userId, sourceId){
  // Query by PK and filter sourcePostId
  const expr = { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':sp': { S: String(sourceId) } };
  const q = await ddb.send(new QueryCommand({ TableName: TBL_SCHEDULED, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: expr, FilterExpression: 'sourcePostId = :sp', Limit: 1 }));
  return (q.Items || []).length > 0;
}

async function putScheduled(item){
  await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));
}

async function main(){
  const accounts = await queryAccounts();
  console.log('accounts count', accounts.length);
  for(const it of accounts){
    try{
      const accountId = getS(it,'accountId') || (getS(it,'SK') || '').replace(/^ACCOUNT#/,'');
      const autoQuote = Boolean(getB(it,'autoQuote') || (getS(it,'autoQuote') === 'true'));
      const monitored = getS(it,'monitoredAccountId') || '';
      if(!accountId || !monitored) continue;
      if(!autoQuote) continue;

      // fetch monitored account token
      const mon = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${monitored}` } }, ProjectionExpression: 'accessToken, oauthAccessToken' }));
      const token = mon.Item?.oauthAccessToken?.S || mon.Item?.accessToken?.S || '';
      if(!token){ console.log('no token for monitored', monitored); continue; }

      const res = await fetchLatestForToken(token,1);
      if(!res.ok){ console.log('fetch failed', monitored, res.status); continue; }
      const posts = Array.isArray(res.data?.data)?res.data.data:[];
      if(posts.length===0){ console.log('no posts for', monitored); continue; }
      const p = posts[0];
      const sourcePostId = String(p.id || p.shortcode || '');
      const sourceShort = String(p.shortcode || '');
      if(!sourcePostId) continue;
      // check duplicates
      const exists = await existsScheduledFor(userId, sourcePostId) || await existsScheduledFor(userId, sourceShort);
      console.log('candidate', accountId, monitored, sourcePostId, 'exists=', exists);
      if(exists) continue;

      const id = `${Date.now()}-${Math.floor(Math.random()*100000)}`;
      const now = Math.floor(Date.now()/1000);
      const item = {
        PK: { S: `USER#${userId}` },
        SK: { S: `SCHEDULEDPOST#${id}` },
        scheduledPostId: { S: id },
        accountId: { S: accountId },
        accountName: { S: getS(it,'displayName') || '' },
        content: { S: '' },
        theme: { S: '引用投稿' },
        scheduledAt: { N: String(now) },
        postedAt: { N: '0' },
        status: { S: 'pending_quote' },
        needsContentAccount: { S: accountId },
        nextGenerateAt: { N: String(now) },
        generateAttempts: { N: '0' },
        isDeleted: { BOOL: false },
        createdAt: { N: String(now) },
        pendingForAutoPostAccount: { S: accountId },
        sourcePostId: { S: sourcePostId },
        sourcePostShortcode: { S: sourceShort },
        type: { S: 'quote' }
      };

      await putScheduled(item);
      console.log('put scheduled', id, 'for account', accountId);
    }catch(e){ console.warn('account processing failed', String(e)); }
  }
}

main().catch(e=>{ console.error(e); process.exit(1) });


