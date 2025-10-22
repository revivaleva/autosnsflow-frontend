#!/usr/bin/env node
/**
 * Backfill postUrl for posted ScheduledPosts by fetching permalink from Threads Graph API.
 * Usage: node scripts/fill-permalink-backfill.js
 * Env:
 *  AWS_REGION (default ap-northeast-1)
 *  TBL_SCHEDULED_POSTS (default ScheduledPosts)
 *  TBL_THREADS_ACCOUNTS (default ThreadsAccounts)
 *  THREADS_GRAPH_BASE (default https://graph.threads.net/v1.0)
 *  BATCH_SLEEP_MS (default 200)
 */
import { DynamoDBClient, ScanCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TABLE = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';
const SLEEP_MS = Number(process.env.BATCH_SLEEP_MS || '200');

const ddb = new DynamoDBClient({ region: REGION });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPermalink(accessToken, postId) {
  try {
    const url = `${BASE}/${encodeURIComponent(postId)}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({}));
    return j?.permalink || null;
  } catch (e) {
    return null;
  }
}

async function main() {
  let lastKey = undefined;
  let processed = 0;
  console.log('Starting fill-permalink backfill...');
  do {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE, ProjectionExpression: 'PK,SK,postId,postUrl,accountId,#st', ExpressionAttributeNames: { '#st': 'status' }, ExclusiveStartKey: lastKey, Limit: 200 }));
    const items = res.Items || [];
    for (const it of items) {
      try {
        const status = it.status?.S || '';
        const postId = it.postId?.S || '';
        const postUrl = it.postUrl?.S || '';
        if (status !== 'posted' || !postId) continue;
        // Normalize postUrl and treat variants like "'-" or surrounding quotes as failed markers
        const normalizedPostUrl = String(postUrl || '').trim().replace(/^'+|'+$/g, '');
        // skip if already has a non-failed URL (not '-' and not a known bad domain)
        if (normalizedPostUrl && normalizedPostUrl !== '-' && !normalizedPostUrl.includes('threadsbooster.jp')) continue;

        const pk = it.PK;
        const sk = it.SK;
        const userId = (pk?.S || '').replace(/^USER#/, '') || null;
        const accountId = it.accountId?.S || null;
        if (!userId || !accountId) continue;

        // fetch account tokens
        const acc = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, ProjectionExpression: 'accessToken, oauthAccessToken' }));
        const accessToken = acc.Item?.accessToken?.S || '';
        const oauth = acc.Item?.oauthAccessToken?.S || '';
        const token = (oauth && oauth.trim()) ? oauth : accessToken;

        if (!token) {
          // mark as failed so we don't retry repeatedly
          await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: { PK: pk, SK: sk }, UpdateExpression: 'SET postUrl = :p', ExpressionAttributeValues: { ':p': { S: '-' } } }));
          console.log('no token, marked failed for', sk?.S || '');
          continue;
        }

        const permalink = await fetchPermalink(token, postId);
        if (!permalink) {
          await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: { PK: pk, SK: sk }, UpdateExpression: 'SET postUrl = :p', ExpressionAttributeValues: { ':p': { S: '-' } } }));
          console.log('permalink not found, marked failed for', sk?.S || '');
        } else {
          await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: { PK: pk, SK: sk }, UpdateExpression: 'SET postUrl = :p', ExpressionAttributeValues: { ':p': { S: permalink } } }));
          console.log('updated postUrl for', sk?.S || '', '->', permalink);
        }

        processed++;
        await sleep(SLEEP_MS);
      } catch (e) {
        console.warn('item processing failed:', String(e).slice(0,200));
        await sleep(SLEEP_MS);
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  console.log('done. processed=', processed);
}

main().catch(e => { console.error(e); process.exit(1); });


