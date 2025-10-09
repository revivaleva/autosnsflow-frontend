import { createDynamoClient } from './ddb';
import { QueryCommand, PutItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import fetchThreadsPosts from './fetch-threads-posts';
import { getTokenForAccount } from './threads-delete';
import { postQuoteToThreads, getThreadsPermalink } from './threads';
import { fetchThreadsRepliesAndSave } from '@/pages/api/fetch-replies';

const ddb = createDynamoClient();
const TBL_THREADS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';

export async function runHourlyQuoteCreation(userId: string) {
  if (!userId) throw new Error('userId required');

  // Fetch all accounts for user
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_THREADS,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } },
  }));
  const items: any[] = (q as any).Items || [];

  for (const it of items) {
    try {
      const accountId = it.accountId?.S || '';
      const autoQuote = !!it.autoQuote?.BOOL;
      const monitored = it.monitoredAccountId?.S || '';
      // time window restriction (JST) support
      const quoteStart = it.quoteTimeStart?.S || '';
      const quoteEnd = it.quoteTimeEnd?.S || '';
      if (!accountId || !monitored) continue;
      // check time window if configured
      if (quoteStart || quoteEnd) {
        try {
          const now = new Date();
          // convert to JST by adding 9 hours
          const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
          const hhmm = (d: Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const nowHM = hhmm(jst);
          const inRange = (() => {
            if (!quoteStart && !quoteEnd) return true;
            const s = quoteStart || '00:00';
            const e = quoteEnd || '24:00';
            if (s <= e) return nowHM >= s && nowHM <= e;
            // overnight range (e.g., 23:00-02:00)
            return nowHM >= s || nowHM <= e;
          })();
          if (!inRange) continue;
        } catch (e) {
          // on parse error, skip time check
        }
      }
      if (!autoQuote) continue; // skip if account not opted-in

      // fetch latest post for this account (limit 1)
      const posts = await fetchThreadsPosts({ userId, accountId, limit: 1 });
      if (!Array.isArray(posts) || posts.length === 0) continue;
      const p = posts[0];
      const sourcePostId = String(p.id || p.shortcode || '');
      if (!sourcePostId) continue;

      // Check if a scheduled post already references this sourcePostId
      const existsQ = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        FilterExpression: 'sourcePostId = :sp',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':sp': { S: sourcePostId } },
        Limit: 1,
      }));
      const existItems = (existsQ as any).Items || [];
      if (existItems.length > 0) continue; // already scheduled or posted

      // create scheduled reservation record (pending_quote)
      const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const now = Math.floor(Date.now() / 1000);
      const item: any = {
        PK: { S: `USER#${userId}` },
        SK: { S: `SCHEDULEDPOST#${id}` },
        scheduledPostId: { S: id },
        accountId: { S: accountId },
        accountName: { S: it.displayName?.S || '' },
        content: { S: '' },
        theme: { S: '引用投稿' },
        scheduledAt: { N: String(now) },
        postedAt: { N: '0' },
        status: { S: 'pending_quote' },
        // mark as needing content so existing generation worker (processPendingGenerationsForAccount)
        // will pick this reservation up and fill `content`.
        needsContentAccount: { S: accountId },
        nextGenerateAt: { N: String(now) },
        generateAttempts: { N: '0' },
        isDeleted: { BOOL: false },
        createdAt: { N: String(now) },
        // marker for GSI (if needed)
        pendingForAutoPostAccount: { S: accountId },
        // quote metadata
        sourcePostId: { S: sourcePostId },
        sourcePostShortcode: { S: String(p.shortcode || '') },
        type: { S: 'quote' },
      };

      await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));
    } catch (e) {
      console.warn('[quote-worker] account processing failed', String(e));
    }
  }
}

export default runHourlyQuoteCreation;

// 5分ジョブ: pending_quote を処理して本文生成→投稿を行う
export async function runPendingQuoteProcessor(userId: string) {
  if (!userId) throw new Error('userId required');
  const ddb2 = createDynamoClient();

  // Query all scheduled posts for user (we'll filter pending_quote client-side)
  const q = await ddb2.send(new QueryCommand({
    TableName: TBL_SCHEDULED,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' } },
    ProjectionExpression: 'SK, scheduledPostId, accountId, status, content, sourcePostId, theme',
  }));
  const items: any[] = (q as any).Items || [];

  for (const it of items) {
    try {
      const status = it.status?.S || '';
      if (status !== 'pending_quote') continue;
      const scheduledPostId = it.scheduledPostId?.S || (it.SK?.S || '').replace(/^SCHEDULEDPOST#/, '');
      const accountId = it.accountId?.S || '';
      const sourcePostId = it.sourcePostId?.S || '';
      if (!scheduledPostId || !accountId || !sourcePostId) continue;

      // get account details (autoPost/autoGenerate and tokens)
      const acc = await ddb2.send(new GetItemCommand({
        TableName: TBL_THREADS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        ProjectionExpression: 'accessToken, oauthAccessToken, autoPost, autoGenerate, providerUserId',
      }));
      const accessToken = acc.Item?.accessToken?.S || '';
      const oauthAccessToken = acc.Item?.oauthAccessToken?.S || '';
      const autoPost = !!acc.Item?.autoPost?.BOOL;
      const autoGenerate = !!acc.Item?.autoGenerate?.BOOL;
      const providerUserId = acc.Item?.providerUserId?.S || '';

      // use existing generation flow: if content is not yet filled by the generator, skip
      const generatedText = it.content?.S || '';
      if (!generatedText) {
        // nothing to post yet; the centralized generation worker (processPendingGenerationsForAccount)
        // will fill `content` as soon as possible. We'll skip until content is present.
        continue;
      }

      if (!autoPost) {
        // content exists but autoPost disabled — ensure content saved and skip posting
        await ddb2.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: 'SET content = :c', ExpressionAttributeValues: { ':c': { S: generatedText } } }));
        continue;
      }

      // perform quote post using the generated content
      const { postId, numericId } = await postQuoteToThreads({ accessToken, oauthAccessToken: oauthAccessToken || undefined, text: generatedText, referencedPostId: sourcePostId, userIdOnPlatform: providerUserId || undefined });
      const nowTs = Math.floor(Date.now() / 1000);
      const names = { '#st': 'status' };
      const values: any = { ':posted': { S: 'posted' }, ':ts': { N: String(nowTs) }, ':pid': { S: postId }, ':f': { BOOL: false } };
      const sets: string[] = ['#st = :posted', 'postedAt = :ts', 'postId = :pid'];

      // numericId があれば保存
      if (numericId) {
        values[':nid'] = { S: numericId };
        sets.push('numericPostId = :nid');
      }

      // attempt to get permalink (if available) to populate postUrl, otherwise mark '-' to avoid repeated retries
      try {
        const tokenForPermalink = (oauthAccessToken && String(oauthAccessToken).trim()) ? oauthAccessToken : accessToken;
        const permalink = await getThreadsPermalink({ accessToken: tokenForPermalink, postId }).catch(() => null);
        if (permalink?.url) {
          values[':purl'] = { S: permalink.url };
          sets.push('postUrl = :purl');
        } else {
          values[':purl'] = { S: '-' };
          sets.push('postUrl = :purl');
        }
      } catch (e) {
        values[':purl'] = { S: '-' };
        sets.push('postUrl = :purl');
      }

      await ddb2.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
      // After posting, trigger reply-fetch for this account to integrate quoted-posts into reply flow
      try {
        const acctObj: any = {
          accountId,
          accessToken: accessToken || '',
          providerUserId: providerUserId || '',
          autoReply: !!acc.Item?.autoReply?.BOOL,
          status: acc.Item?.status?.S || 'active',
        };
        // run reply fetch/processing for this account (lookback 1 day)
        await fetchThreadsRepliesAndSave({ acct: acctObj, userId, lookbackSec: 24 * 3600 });
      } catch (e) {
        // ignore errors from reply processing to avoid breaking post flow
        console.warn('[quote-worker] reply processing after quote post failed', e);
      }
    } catch (e) {
      console.warn('[pending-quote] processing failed', e);
    }
  }
}


