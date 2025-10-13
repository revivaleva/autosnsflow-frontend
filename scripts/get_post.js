#!/usr/bin/env node
const { DynamoDBClient, ScanCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const fetch = global.fetch || require('node-fetch');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/get_post.js <numericId_or_shortcode>');
    process.exit(2);
  }
  const id = args[0];
  const region = process.env.AWS_REGION || 'us-east-1';
  const ddb = new DynamoDBClient({ region });

  const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';
  const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';

  // Scan ScheduledPosts for item matching numericPostId or postId
  const filterExpr = 'numericPostId = :nid OR postId = :sid';
  try {
    const scan = await ddb.send(new ScanCommand({
      TableName: TBL_SCHEDULED,
      FilterExpression: filterExpr,
      ExpressionAttributeValues: {
        ':nid': { S: id },
        ':sid': { S: id }
      },
      ProjectionExpression: 'PK, SK, postId, numericPostId, content, accountId'
    }));

    if (!scan.Items || scan.Items.length === 0) {
      console.error('No scheduled post found for id=', id);
      process.exit(1);
    }
    const item = scan.Items[0];
    const pk = item.PK.S; // USER#<userId>
    const accountId = item.accountId.S;
    // extract userId from PK
    const userId = pk.startsWith('USER#') ? pk.slice(5) : pk;

    // read ThreadsAccounts for token
    const key = { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } };
    const out = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: key, ProjectionExpression: 'accessToken, oauthAccessToken' }));
    const acct = out.Item || {};
    const token = (acct.oauthAccessToken && acct.oauthAccessToken.S) || (acct.accessToken && acct.accessToken.S) || null;
    if (!token) {
      console.error('No token found for account', accountId, 'user', userId);
      process.exit(1);
    }

    // call Threads Graph API to get post text
    const base = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';
    const url = `${base}/${encodeURIComponent(id)}?fields=text&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text();
      console.error('Graph API failed:', r.status, r.statusText, txt.substring(0,300));
      process.exit(1);
    }
    const j = await r.json();
    console.log('post_text:', j.text || j?.message || JSON.stringify(j).slice(0,300));
  } catch (e) {
    console.error('Error:', String(e).substring(0,300));
    process.exit(1);
  }
}

main();


