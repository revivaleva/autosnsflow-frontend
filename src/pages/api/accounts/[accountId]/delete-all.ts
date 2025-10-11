import type { NextApiRequest, NextApiResponse } from 'next';
import { QueryCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';
import { putLog } from '@/lib/logger';
import { deleteUserPosts } from '@/lib/delete-user-posts';
import { fetchThreadsPosts } from '@/lib/fetch-threads-posts';

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED || 'ScheduledPosts';
const TBL_THREADS_ACCOUNTS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const TBL_DELETION_QUEUE = process.env.TBL_DELETION_QUEUE || 'DeletionQueue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    const accountId = Array.isArray(req.query.accountId) ? req.query.accountId[0] : req.query.accountId;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    // debug log removed
    // Ensure AppConfig is loaded from preloaded file or DB before proceeding
    // Ensure AppConfig is loaded; fail-fast on error
    try {
      const cfgMod = await import('@/lib/config');
      if (typeof cfgMod.loadConfig === 'function') {
        await cfgMod.loadConfig();
        // debug log removed
      }
    } catch (e) {
      // debug error removed
      return res.status(500).json({ error: 'appconfig_load_failed' });
    }

    // parse body for mode/dryRun
    const body = (req.body || {}) as any;
    const mode = body?.mode;

    // NOTE: immediate/dryRun counting was removed to allow actual deletion tests.
    // Requests with mode='immediate' will fall through to the default deletion behavior below.

    // Mode: 'background' => create queue and set account status without performing deletions
    if (mode === 'background') {
      // check candidates count first (dry run)
      // Return detailed dryRun info for testing: totalCandidates, fetchedCount
      const dr = await deleteUserPosts({ userId, accountId, dryRun: true });
      if (typeof dr.totalCandidates === 'undefined') {
        console.error('[delete-all] deleteUserPosts dryRun failed to return totalCandidates');
        return res.status(500).json({ error: 'delete_dryrun_failed' });
      }
      const totalCandidates = dr.totalCandidates || 0;
      const fetchedCount = dr.fetchedCount || 0;
      // Always create a deletion queue entry for background mode so we can perform
      // DB-side cleanup even when there are 0 external candidates.
      const now = Math.floor(Date.now() / 1000);
      const qItem: any = {
        PK: { S: `ACCOUNT#${accountId}` },
        SK: { S: `DELETION#${now}#${Math.random().toString(36).slice(2, 8)}` },
        accountId: { S: accountId },
        userId: { S: userId },
        createdAt: { N: String(now) },
        // For background mode we still set last_processed_at to 0 so worker can run immediately.
        last_processed_at: { N: '0' },
        processing: { BOOL: false },
        retry_count: { N: '0' },
      };
      try {
        const tableName = (await import('@/lib/config').then(m => m.getConfigValue('TBL_DELETION_QUEUE'))) || TBL_DELETION_QUEUE;
        await ddb.send(new PutItemCommand({ TableName: tableName, Item: qItem }));
        // Mark account as deleting and disable automation flags (include autoQuote)
        await ddb.send(new UpdateItemCommand({ TableName: TBL_THREADS_ACCOUNTS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET #st = :s, autoPost = :f, autoGenerate = :f, autoReply = :f, autoQuote = :f', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'deleting' }, ':f': { BOOL: false } } }));
        } catch (e) {
        await putLog({ userId, accountId, action: 'deletion_queue', status: 'error', message: String((e as any)?.message || e) });
        return res.status(500).json({ error: 'queue_create_failed' });
      }
      await putLog({ userId, accountId, action: 'deletion_queue', status: 'info', message: 'deletion queued', detail: { totalCandidates, fetchedCount } });
      const resp = { status: 'queued', totalCandidates, fetchedCount };
        // debug log removed
      return res.status(200).json(resp);
    }

    // Default: perform actual deletion now (legacy behavior)
    // Determine limit from AppConfig.DELETION_BATCH_SIZE if not provided
    let effectiveLimit: number | undefined = undefined;
    try {
      const cfg = await import('@/lib/config');
      const v = cfg.getConfigValue('DELETION_BATCH_SIZE');
      effectiveLimit = Number(v || '100') || 100;
    } catch (_) {
      effectiveLimit = 100;
    }
    // Perform actual deletion using local helper which delegates to shared implementation via adapters
    const { deletedCount, remaining } = await deleteUserPosts({ userId, accountId, limit: effectiveLimit });
    // debug log removed

    if (remaining) {
      // create deletion queue entry
      const now2 = Math.floor(Date.now() / 1000);
      const qItem: any = {
        PK: { S: `ACCOUNT#${accountId}` },
        SK: { S: `DELETION#${now2}#${Math.random().toString(36).slice(2, 8)}` },
        accountId: { S: accountId },
        userId: { S: userId },
        createdAt: { N: String(now2) },
        // For immediate deletion path, set last_processed_at to now so periodic worker waits until interval passes.
        last_processed_at: { N: String(now2) },
        processing: { BOOL: false },
        retry_count: { N: '0' },
      };
      try {
        const tableName = (await import('@/lib/config').then(m => m.getConfigValue('TBL_DELETION_QUEUE'))) || TBL_DELETION_QUEUE;
        await ddb.send(new PutItemCommand({ TableName: tableName, Item: qItem }));
        // set account status to deleting and disable autoQuote
        await ddb.send(new UpdateItemCommand({ TableName: TBL_THREADS_ACCOUNTS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET #st = :s, autoQuote = :f', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'deleting' }, ':f': { BOOL: false } } }));
      } catch (e) {
        await putLog({ userId, accountId, action: 'deletion_queue', status: 'error', message: String((e as any)?.message || e) });
        return res.status(500).json({ error: 'queue_create_failed' });
      }
      await putLog({ userId, accountId, action: 'deletion_queue', status: 'info', message: 'deletion queued', detail: { deletedCount } });
      const resp = { status: 'queued', deletedCount };
      // debug log removed
      return res.status(200).json(resp);
    }

    // all deleted
    await putLog({ userId, accountId, action: 'deletion', status: 'info', message: 'all posts deleted', detail: { deletedCount } });
    const resp = { status: 'completed', deletedCount };
    // debug log removed
    return res.status(200).json(resp);
  } catch (e: any) {
    // debug error removed
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
  }
}
