import type { NextApiRequest, NextApiResponse } from 'next';
import { createDynamoClient } from '@/lib/ddb';
import { GetItemCommand, UpdateItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { buffer } from 'stream/consumers';
import { verifyUserFromRequest } from '@/lib/auth';

const ddb = createDynamoClient();
const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';
const TBL_X_SCHEDULED = process.env.TBL_X_SCHEDULED || 'XScheduledPosts';
const TBL_POST_POOL = process.env.TBL_POST_POOL || 'PostPool';
const TBL_USER_TYPE_TIME_SETTINGS = process.env.TBL_USER_TYPE_TIME_SETTINGS || 'UserTypeTimeSettings';
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-1';
const s3 = new S3Client({ region: AWS_REGION });

// Helper: Upload video to X v2 using chunked upload (Initialize -> Append -> Finalize)
// Follows X API v2 video upload specification with proper endpoints
async function uploadVideoToX(accessToken: string, mediaBuffer: Buffer): Promise<string | null> {
  try {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

    try { console.log('[api/x/tweet] uploading video with chunked upload', { size: mediaBuffer.length, chunks: Math.ceil(mediaBuffer.length / CHUNK_SIZE) }); } catch(_) {}

    // Step 1: Initialize - Create upload session with JSON body
    // X API v2 spec: POST /2/media/upload/initialize
    const initBody = {
      media_category: 'tweet_video',
      media_type: 'video/mp4',
      total_bytes: mediaBuffer.length,
      shared: false
    };

    try { 
      console.log('[api/x/tweet] video Initialize request', { 
        url: 'https://api.x.com/2/media/upload/initialize',
        body: initBody
      }); 
    } catch(_) {}

    const initRes = await fetch('https://api.x.com/2/media/upload/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(initBody),
    });

    const initData = await initRes.json().catch(() => ({})) as any;
    
    // X API v2 returns { data: { id: "..." } }
    const mediaId = initData?.data?.id;
    
    if (!initRes.ok || !mediaId) {
      try { 
        console.error('[api/x/tweet] video Initialize failed', { 
          status: initRes.status,
          title: initData?.title,
          detail: initData?.detail,
          errors: initData?.errors,
          responseBody: initData
        }); 
      } catch(_) {}
      return null;
    }

    try { console.log('[api/x/tweet] video upload session initialized', { mediaId }); } catch(_) {}

    // Step 2: Append - Send video data in chunks
    // X API v2 spec: POST /2/media/upload/{id}/append with multipart/form-data
    let totalSent = 0;
    for (let i = 0; i < mediaBuffer.length; i += CHUNK_SIZE) {
      const chunk = mediaBuffer.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE);

      try { console.log('[api/x/tweet] uploading chunk', { chunkIndex, size: chunk.length, totalSent }); } catch(_) {}

      const appendFormData = new FormData();
      const blob = new Blob([chunk], { type: 'video/mp4' });
      appendFormData.append('media', blob, 'video.mp4');
      appendFormData.append('segment_index', String(chunkIndex));

      const appendRes = await fetch(`https://api.x.com/2/media/upload/${mediaId}/append`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          // FormData will set Content-Type with boundary
        },
        body: appendFormData as any,
      });

      if (!appendRes.ok) {
        const errJson = await appendRes.json().catch(() => ({})) as any;
        try { console.error('[api/x/tweet] chunk upload failed', { status: appendRes.status, chunk: chunkIndex, errors: errJson?.errors }); } catch(_) {}
        return null;
      }

      totalSent += chunk.length;
    }

    // Step 3: Finalize - Complete upload
    // X API v2 spec: POST /2/media/upload/{id}/finalize (no body)
    try { console.log('[api/x/tweet] finalizing video upload', { mediaId }); } catch(_) {}

    const finalizeRes = await fetch(`https://api.x.com/2/media/upload/${mediaId}/finalize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const finalizeData = await finalizeRes.json().catch(() => ({})) as any;

    if (!finalizeRes.ok) {
      try { console.error('[api/x/tweet] video Finalize failed', { status: finalizeRes.status, errors: finalizeData?.errors }); } catch(_) {}
      return null;
    }

    const processingState = finalizeData?.data?.processing_info?.state || 'succeeded';
    try { 
      console.log('[api/x/tweet] video Finalize completed', { 
        mediaId,
        processingState
      }); 
    } catch(_) {}

    // If processing is pending or in_progress, wait for it to complete
    if (processingState === 'pending' || processingState === 'in_progress') {
      try { 
        console.log('[api/x/tweet] video encoding in progress, waiting for processing...', { mediaId, initialState: processingState }); 
      } catch(_) {}
      
      const checkAfterSecs = finalizeData?.data?.processing_info?.check_after_secs || 5;
      const success = await waitForVideoProcessing(accessToken, mediaId, processingState, checkAfterSecs);
      
      if (!success) {
        try { console.error('[api/x/tweet] video processing failed or timeout', { mediaId }); } catch(_) {}
        return null;
      }
    } else if (processingState === 'failed') {
      try { console.error('[api/x/tweet] video processing failed', { mediaId }); } catch(_) {}
      return null;
    }

    try { 
      console.log('[api/x/tweet] video uploaded and processed successfully', { mediaId }); 
    } catch(_) {}
    
    return String(mediaId);

  } catch (e: any) {
    try { console.error('[api/x/tweet] video chunked upload failed:', String(e)); } catch(_) {}
    return null;
  }
}

// Helper: Get media processing status
async function getMediaStatus(accessToken: string, mediaId: string): Promise<{ state: string; checkAfterSecs: number } | null> {
  try {
    const url = new URL('https://api.x.com/2/media/upload');
    url.searchParams.set('command', 'STATUS');
    url.searchParams.set('media_id', mediaId);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const json = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      try { console.error('[api/x/tweet] STATUS request failed', { status: res.status, errors: json?.errors }); } catch(_) {}
      return null;
    }

    const processingInfo = json?.data?.processing_info;
    const state = processingInfo?.state || 'succeeded';
    const checkAfterSecs = processingInfo?.check_after_secs || 5;

    return { state, checkAfterSecs };
  } catch (e: any) {
    try { console.error('[api/x/tweet] STATUS request error:', String(e)); } catch(_) {}
    return null;
  }
}

// Helper: Wait for video processing to complete (poll STATUS endpoint)
async function waitForVideoProcessing(
  accessToken: string,
  mediaId: string,
  initialState: string,
  initialCheckAfter: number
): Promise<boolean> {
  let state = initialState;
  let checkAfterSecs = initialCheckAfter;
  let attempts = 0;
  const MAX_ATTEMPTS = 30; // Max 30 attempts (roughly 2-3 minutes depending on check_after_secs)
  const MAX_WAIT_TIME = 180000; // 3 minutes max wait
  const startTime = Date.now();

  while (state === 'pending' || state === 'in_progress') {
    attempts++;
    
    if (attempts > MAX_ATTEMPTS || (Date.now() - startTime) > MAX_WAIT_TIME) {
      try { 
        console.error('[api/x/tweet] video processing timeout', { 
          mediaId, 
          attempts, 
          finalState: state,
          elapsedMs: Date.now() - startTime
        }); 
      } catch(_) {}
      return false;
    }

    try { 
      console.log('[api/x/tweet] waiting before STATUS check', { 
        mediaId, 
        state, 
        checkAfterSecs, 
        attempts 
      }); 
    } catch(_) {}

    // Wait for the recommended check_after_secs
    await new Promise(resolve => setTimeout(resolve, checkAfterSecs * 1000));

    const status = await getMediaStatus(accessToken, mediaId);
    if (!status) {
      try { console.warn('[api/x/tweet] STATUS check returned null, retrying...', { attempts }); } catch(_) {}
      checkAfterSecs = 5; // Fallback to 5 seconds
      continue;
    }

    state = status.state;
    checkAfterSecs = status.checkAfterSecs;

    try { 
      console.log('[api/x/tweet] STATUS check result', { 
        mediaId, 
        state, 
        checkAfterSecs, 
        attempts 
      }); 
    } catch(_) {}

    if (state === 'failed') {
      try { console.error('[api/x/tweet] video processing failed', { mediaId }); } catch(_) {}
      return false;
    }

    if (state === 'succeeded') {
      try { 
        console.log('[api/x/tweet] video processing succeeded', { 
          mediaId, 
          attemptsNeeded: attempts 
        }); 
      } catch(_) {}
      return true;
    }
  }

  // Should not reach here, but if state is already succeeded, return true
  return state === 'succeeded';
}

// Helper: Download media from S3 URL (s3://bucket/key format)
async function downloadMediaFromS3(s3Url: string): Promise<Buffer | null> {
  try {
    if (!s3Url.startsWith('s3://')) {
      try { console.warn('[api/x/tweet] invalid S3 URL format:', s3Url); } catch(_) {}
      return null;
    }

    const parts = s3Url.slice(5).split('/');
    const bucket = parts[0];
    const key = parts.slice(1).join('/');

    try { console.log('[api/x/tweet] downloading from S3', { bucket, key: key.slice(0, 50) }); } catch(_) {}

    const getObjResp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    
    // Use Node.js stream/consumers instead of AWS util which has bundling issues in Next.js
    const mediaBuffer = await buffer(getObjResp.Body as any);
    
    try { console.log('[api/x/tweet] S3 download successful', { size: mediaBuffer.length }); } catch(_) {}
    return mediaBuffer;
  } catch (e: any) {
    try { console.error('[api/x/tweet] failed to download from S3:', e?.message || String(e)); } catch(_) {}
    return null;
  }
}

// Helper: Claim pool item for X posting (similar to Lambda logic)
async function claimPoolItemForX(
  userId: string,
  accountType: string
): Promise<{ content: string; images: string[]; poolId: string } | null> {
  try {
    // Validate accountType before querying
    const validTypes = ['general', 'ero', 'ero1', 'ero2', 'saikyou'];
    if (!validTypes.includes(accountType)) {
      try { console.error('[api/x/tweet] invalid accountType passed to claimPoolItemForX', { accountType, validTypes }); } catch(_) {}
      return null;
    }
    
    try { console.log('[api/x/tweet] claiming pool item', { userId, accountType }); } catch(_) {}

    // Query pool items for this user
    const pq = await ddb.send(new QueryCommand({
      TableName: TBL_POST_POOL,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'POOL#' } },
      Limit: 50,
    }));
    
    const pitems: any[] = (pq as any).Items || [];
    if (pitems.length === 0) {
      try { console.log('[api/x/tweet] no pool items found'); } catch(_) {}
      return null;
    }

    // Filter by account type - validate PK ownership
    const pcands = pitems
      .map(itm => ({
        pk: itm.PK,
        sk: itm.SK,
        poolId: itm.poolId?.S || (itm.SK?.S || '').replace(/^POOL#/, ''),
        type: itm.type?.S || 'general',
        content: itm.content?.S || '',
        images: itm.images?.S ? JSON.parse(itm.images.S) : [],
      }))
      .filter(x => {
        // Security: verify pool item belongs to this user
        const poolPk = x.pk?.S;
        const expectedPk = `USER#${userId}`;
        if (poolPk && poolPk !== expectedPk) {
          try { console.error('[api/x/tweet] SECURITY: pool item PK mismatch', { poolPk, expectedPk, userId, poolId: x.poolId }); } catch(_) {}
          return false;
        }
        // Type filter
        return (x.type || 'general') === accountType;
      });

    if (pcands.length === 0) {
      try { console.log('[api/x/tweet] no matching pool items for type', { accountType, totalPoolItems: pitems.length }); } catch(_) {}
      return null;
    }

    // Check reuse setting
    let reuse = false;
    try {
      const us = await ddb.send(new GetItemCommand({
        TableName: TBL_USER_TYPE_TIME_SETTINGS,
        Key: { user_id: { S: userId }, type: { S: accountType } },
        ProjectionExpression: 'reuse',
      }));
      const uit: any = (us as any).Item || {};
      reuse = Boolean(uit.reuse && (uit.reuse.BOOL === true || String(uit.reuse.S) === 'true'));
    } catch (_) {
      reuse = false;
    }

    try { console.log('[api/x/tweet] pool reuse mode', { reuse, candidateCount: pcands.length }); } catch(_) {}

    if (reuse) {
      // Reuse mode: just pick the first one
      const chosen = pcands[0];
      try { console.log('[api/x/tweet] reuse mode: picked pool item', { poolId: chosen.poolId }); } catch(_) {}
      return { content: chosen.content, images: chosen.images, poolId: chosen.poolId };
    } else {
      // Consume mode: try to atomically delete
      for (const cand of pcands) {
        try {
          try { console.log('[api/x/tweet] attempting to claim pool item', { poolId: cand.poolId }); } catch(_) {}
          const delRes: any = await ddb.send(new DeleteItemCommand({
            TableName: TBL_POST_POOL,
            Key: { PK: { S: String(cand.pk.S) }, SK: { S: String(cand.sk.S) } },
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
            ReturnValues: 'ALL_OLD',
          }));

          const attrs = delRes?.Attributes || null;
          if (attrs) {
            const content = attrs.content?.S || cand.content || '';
            const images = attrs.images?.S ? JSON.parse(attrs.images.S) : (cand.images || []);
            try { console.log('[api/x/tweet] pool item claimed successfully', { poolId: cand.poolId }); } catch(_) {}
            return { content, images, poolId: cand.poolId };
          }
        } catch (e: any) {
          try { console.log('[api/x/tweet] failed to claim pool item', { poolId: cand.poolId, err: String(e) }); } catch(_) {}
          continue;
        }
      }
      try { console.log('[api/x/tweet] could not claim any pool item'); } catch(_) {}
      return null;
    }
  } catch (e: any) {
    try { console.error('[api/x/tweet] error claiming pool item', String(e)); } catch(_) {}
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    // debug logging removed
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { accountId, text, scheduledPostId, content } = body || {};

    try { console.log('[api/x/tweet] request', { userId, accountId, text, scheduledPostId, content }); } catch(_) {}

    // Accept content as alternative to text parameter
    if (!text && content) {
      text = content;
    }

    // Store actual SK for use throughout the function
    let actualSk = '';
    
    // If scheduledPostId provided, always fetch from DB to ensure we have latest data
    if (scheduledPostId) {
      try {
        // Try to construct full SK from scheduledPostId (format: accountId#date#timeRange)
        // If scheduledPostId is a UUID-like value, it might be from old API format
        let sk = `SCHEDULEDPOST#${scheduledPostId}`;
        
        // If body contains full SK, use it directly
        if ((body as any).sk) {
          sk = (body as any).sk;
          try { console.log('[api/x/tweet] using provided SK', { sk }); } catch(_) {}
        }
        
        const getResp = await ddb.send(new GetItemCommand({
          TableName: TBL_X_SCHEDULED,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: sk } }
        }));
        const scheduled: any = (getResp as any).Item || {};
        
        // Store the actual SK for later use
        actualSk = scheduled.SK?.S || '';
        
        // Security check: verify that the fetched record belongs to this user
        const fetchedPk = scheduled.PK?.S;
        const expectedPk = `USER#${userId}`;
        if (fetchedPk && fetchedPk !== expectedPk) {
          try { console.error('[api/x/tweet] SECURITY: scheduled post PK mismatch', { fetchedPk, expectedPk, scheduledPostId, userId }); } catch(_) {}
          return res.status(403).json({ error: 'unauthorized_scheduled_post', detail: 'scheduled post does not belong to user' });
        }
        
        // Full debug logging of fetched data
        try { console.log('[api/x/tweet] fetched scheduled post full data', { 
          pk: scheduled.PK?.S,
          sk: scheduled.SK?.S,
          accountId: scheduled.accountId?.S,
          accountName: scheduled.accountName?.S,
          content: scheduled.content?.S ? `(${String(scheduled.content.S).slice(0, 50)}...)` : '(empty)',
          images: scheduled.images?.S ? '(present)' : '(empty)',
          type: scheduled.type?.S,
          poolType: scheduled.poolType?.S,
          status: scheduled.status?.S,
          requestAccountId: accountId,
          requestText: text ? `(${String(text).slice(0, 50)}...)` : '(empty)'
        }); } catch(_) {}
        
        // Always prefer DB values for official data
        accountId = accountId || (scheduled.accountId?.S || '');
        text = text || (scheduled.content?.S || '');
        
        // Extract media URLs from DB if available
        let mediaUrls: string[] = [];
        if (scheduled.images && scheduled.images.S) {
          try {
            mediaUrls = JSON.parse(scheduled.images.S);
          } catch (_) {}
        }
        
        // For immediate posting: detect if this is a manual immediate post
        // (has scheduledPostId but no explicit text/content in request body)
        // In this case, always claim fresh content from pool
        const isManualImmediate = scheduledPostId && !body.text && !body.content;
        try { console.log('[api/x/tweet] immediate post detection', { isManualImmediate, scheduledPostId, bodyHasText: !!body.text, bodyHasContent: !!body.content }); } catch(_) {}
        
        // If content is still empty OR this is a manual immediate post, try to claim from pool using account type
        if (!text || isManualImmediate) {
          try {
            let accountType = scheduled.type?.S || scheduled.poolType?.S;
            
            // If type is not in scheduled post, fetch it from XAccounts
            if (!accountType) {
              try {
                const accResp = await ddb.send(new GetItemCommand({
                  TableName: TBL_X,
                  Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
                  ProjectionExpression: 'type'
                }));
                const accItem: any = (accResp as any).Item || {};
                accountType = accItem.type?.S || 'general';
                try { console.log('[api/x/tweet] resolved accountType from XAccounts', { accountId, accountType }); } catch(_) {}
              } catch (_) {
                accountType = 'general';
                try { console.log('[api/x/tweet] failed to fetch account type, defaulting to general', { accountId }); } catch(_) {}
              }
            }
            
            // Validate accountType
            const validTypes = ['general', 'ero', 'ero1', 'ero2', 'saikyou'];
            if (!validTypes.includes(accountType)) {
              try { console.warn('[api/x/tweet] invalid accountType detected', { accountType, validTypes }); } catch(_) {}
              accountType = 'general';
            }
            
            try { console.log('[api/x/tweet] content empty, attempting pool claim', { accountId, accountType, scheduledPostId }); } catch(_) {}
            
            const poolItem = await claimPoolItemForX(userId, accountType);
            if (poolItem) {
              // For immediate posts, always use pool content to ensure freshness
              if (isManualImmediate) {
                try { console.log('[api/x/tweet] manual immediate post: replacing text with pool content', { previousContent: text ? `(${String(text).slice(0, 30)}...)` : '(empty)', poolContent: `(${String(poolItem.content).slice(0, 30)}...)` }); } catch(_) {}
              }
              text = poolItem.content;
              mediaUrls = poolItem.images || [];
              try { console.log('[api/x/tweet] claimed pool item', { poolId: poolItem.poolId, contentLength: text.length, imagesCount: mediaUrls.length, accountType, isManualImmediate }); } catch(_) {}
              
              // Update scheduled post with claimed content and images
              // Use ConditionExpression to prevent creating new records if item doesn't exist
              try {
                const nowTs = Math.floor(Date.now() / 1000);
                // Use the actual SK retrieved from DB, not reconstructed one
                const updateSk = actualSk || `SCHEDULEDPOST#${scheduledPostId}`;
                await ddb.send(new UpdateItemCommand({
                  TableName: TBL_X_SCHEDULED,
                  Key: { PK: { S: `USER#${userId}` }, SK: { S: updateSk } },
                  UpdateExpression: 'SET content = :c, images = :imgs, updatedAt = :now',
                  ConditionExpression: 'attribute_exists(PK)',
                  ExpressionAttributeValues: {
                    ':c': { S: text },
                    ':imgs': { S: JSON.stringify(mediaUrls) },
                    ':now': { N: String(nowTs) },
                  },
                }));
                try { console.log('[api/x/tweet] updated scheduled post with pool content', { scheduledPostId, sk: updateSk }); } catch(_) {}
              } catch (e) {
                // Only log warning if it's not a ConditionalCheckFailedException (which means record doesn't exist)
                if (String(e).includes('ConditionalCheckFailed')) {
                  try { console.warn('[api/x/tweet] scheduled post record not found, skipping pool content update', { scheduledPostId }); } catch(_) {}
                } else {
                  try { console.warn('[api/x/tweet] failed to update scheduled post with pool item', String(e)); } catch(_) {}
                }
              }
            } else {
              try { console.warn('[api/x/tweet] pool claim returned null', { accountType, userId, isManualImmediate }); } catch(_) {}
            }
          } catch (e) {
            try { console.warn('[api/x/tweet] pool claim failed', String(e)); } catch(_) {}
          }
        }
        
        // Store mediaUrls for later use
        (req as any).mediaUrls = mediaUrls;
      } catch (e) {
        try { console.warn('[api/x/tweet] failed to fetch scheduled post from DB', String(e)); } catch(_) {}
      }
    }

    if (!accountId) return res.status(400).json({ error: 'accountId required', debug: { accountId, text, scheduledPostId } });
    
    // Allow empty text (happens with auto-post group scheduled posts that haven't been generated yet)
    // Warn but don't fail
    if (!text) {
      try { console.warn('[api/x/tweet] WARNING: text is empty, will post with empty text', { accountId, scheduledPostId }); } catch(_) {}
    }

    // Read account token from XAccounts table
    const out = await ddb.send(new GetItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
    const it: any = (out as any).Item || {};
    // Prefer oauthAccessToken, fall back to legacy accessToken
    let tokenFromDb = String(it.oauthAccessToken?.S || it.accessToken?.S || '');
    // Read refresh token and expiry (handle either naming)
    const refreshTokenFromDb = String(it.refreshToken?.S || it.oauthRefreshToken?.S || '');
    const expiresAtRaw = it.oauthTokenExpiresAt?.N || it.oauthTokenExpiresAt?.S || null;
    const oauthTokenExpiresAt = expiresAtRaw ? Number(expiresAtRaw) : 0;
    let token = tokenFromDb;
    let usingFallback = false;
    if (!token) {
      try {
        const cfg = await import('@/lib/config');
        const m = await cfg.loadConfig();
        const fallbackToken = m['X_APP_DEFAULT_TOKEN'] || '';
        if (fallbackToken) { token = fallbackToken; usingFallback = true; }
      } catch (e) { console.warn('[api/x/tweet] loadConfig failed', String(e)); }
    }
    // debug logging removed
    // If token is about to expire within threshold, attempt refresh synchronously
    let refreshThreshold = Number(process.env.TOKEN_REFRESH_THRESHOLD_SEC || process.env.TOKEN_REFRESH_THRESHOLD || '60');
    try {
      const cfg = await import('@/lib/config');
      const m = await cfg.loadConfig();
      const cfgVal = m['TOKEN_REFRESH_THRESHOLD_SEC'] || m['TOKEN_REFRESH_THRESHOLD'];
      if (cfgVal) refreshThreshold = Number(cfgVal);
      if (cfgVal) try { console.log('[api/x/tweet] using TOKEN_REFRESH_THRESHOLD_SEC from AppConfig', refreshThreshold); } catch(_) {}
    } catch (e) {
      // ignore and use env/default
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (!token && !refreshTokenFromDb) return res.status(403).json({ error: 'no_token' });
    if (oauthTokenExpiresAt && oauthTokenExpiresAt - nowSec <= refreshThreshold && refreshTokenFromDb) {
      try {
        // Resolve clientId/secret from DB or AppConfig
        const clientId = String(it.clientId?.S || it.client_id?.S || '');
        const clientSecret = String(it.clientSecret?.S || it.client_secret?.S || '');
        let tokenUrl = 'https://api.x.com/2/oauth2/token';
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshTokenFromDb);
        if (clientId && !clientSecret) {
          // include client_id if no secret is provided
          params.append('client_id', clientId);
        }
        const headers: Record<string,string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (clientId && clientSecret) {
          headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
        }
        const refreshResp = await fetch(tokenUrl, { method: 'POST', headers, body: params });
        const refreshJson = await refreshResp.json().catch(() => ({}));
        if (refreshResp.ok && refreshJson.access_token) {
          token = String(refreshJson.access_token || '');
          const newRefreshToken = String(refreshJson.refresh_token || refreshTokenFromDb);
          const expiresIn = Number(refreshJson.expires_in || 0);
          const newExpiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : 0;
          // persist new tokens
          try {
            await ddb.send(new UpdateItemCommand({
              TableName: TBL_X,
              Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
              UpdateExpression: 'SET oauthAccessToken = :at, refreshToken = :rt, oauthTokenExpiresAt = :exp, oauthSavedAt = :now',
              ExpressionAttributeValues: {
                ':at': { S: String(token) },
                ':rt': { S: String(newRefreshToken) },
                ':exp': { N: String(newExpiresAt || 0) },
                ':now': { N: String(Math.floor(Date.now() / 1000)) }
              }
            }));
          } catch (dbErr) {
            console.warn('[api/x/tweet] failed to persist refreshed token', String(dbErr));
          }
        }
      } catch (e) {
        console.warn('[api/x/tweet] token refresh failed', String(e));
        // fall through and attempt to use existing token (may be invalid)
      }
    }

    // Get mediaUrls stored during pool claim
    const mediaUrls: string[] = (req as any).mediaUrls || [];
    
    try { console.log('[api/x/tweet] posting to X API', { text: text.slice(0, 50), mediaUrls: mediaUrls.length }); } catch(_) {}
    
    // Upload media to X v2 API if we have media URLs from S3
    const mediaIds: string[] = [];
    if (mediaUrls.length > 0) {
      try {
        for (const mediaUrl of mediaUrls.slice(0, 4)) {
          try {
            // Download media from S3 using AWS SDK
            const mediaBuffer = await downloadMediaFromS3(mediaUrl);
            if (!mediaBuffer) {
              try { console.warn('[api/x/tweet] failed to download media from S3', { mediaUrl }); } catch(_) {}
              continue;
            }
            
            // Determine media type and category from URL extension
            const ext = mediaUrl.split('.').pop()?.toLowerCase() || 'jpg';
            const mediaTypeMap: Record<string, string> = {
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              png: 'image/png',
              gif: 'image/gif',
              webp: 'image/webp',
              mp4: 'video/mp4',
              mov: 'video/quicktime',
              avi: 'video/x-msvideo',
              webm: 'video/webm',
            };
            const mediaType = mediaTypeMap[ext] || 'image/jpeg';
            const isVideo = ['mp4', 'mov', 'avi', 'webm'].includes(ext);
            
            let mediaId: string | null = null;
            
            if (isVideo) {
              // Use chunked upload for videos
              try { console.log('[api/x/tweet] uploading video', { mediaUrl, size: mediaBuffer.length, mediaType }); } catch(_) {}
              mediaId = await uploadVideoToX(token, mediaBuffer);
            } else {
              // Use simple multipart upload for images
              try { console.log('[api/x/tweet] uploading image to X v2', { mediaUrl, size: mediaBuffer.length, mediaType }); } catch(_) {}
              
              const formData = new FormData();
              const blob = new Blob([new Uint8Array(mediaBuffer)], { type: mediaType });
              formData.append('media', blob);
              formData.append('media_type', mediaType);
              formData.append('media_category', 'tweet_image');
              
              const uploadRes = await fetch('https://api.x.com/2/media/upload', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                },
                body: formData as any,
              });
              
              const uploadData = await uploadRes.json().catch(() => ({}));
              
              if (!uploadRes.ok) {
                try { console.warn('[api/x/tweet] image upload failed', { status: uploadRes.status, uploadData }); } catch(_) {}
                continue;
              }
              
              // X v2 API returns { data: { id: "..." } } format
              mediaId = uploadData?.data?.id || uploadData?.media_id_string || uploadData?.media_id;
            }
            
            if (!mediaId) {
              try { console.warn('[api/x/tweet] no media_id received', { mediaUrl }); } catch(_) {}
              continue;
            }
            
            mediaIds.push(String(mediaId));
            try { console.log('[api/x/tweet] media uploaded successfully', { mediaId, isVideo }); } catch(_) {}
            
          } catch (e: any) {
            try { console.error('[api/x/tweet] error uploading media', String(e)); } catch(_) {}
            continue;
          }
        }
      } catch (e: any) {
        try { console.error('[api/x/tweet] media upload loop failed', String(e)); } catch(_) {}
      }
    }
    
    // If media URLs were provided but no media IDs were obtained, fail early
    if (mediaUrls.length > 0 && mediaIds.length === 0) {
      try { console.error('[api/x/tweet] media upload failed - no media IDs obtained', { mediaUrlsCount: mediaUrls.length }); } catch(_) {}
      return res.status(502).json({ 
        error: 'media_upload_failed', 
        message: 'Failed to upload media to X API',
        mediaUrlsRequested: mediaUrls.length,
        mediaIdsObtained: 0
      });
    }
    
    // Build tweet body with media if available
    const tweetBody: any = { text };
    if (mediaIds.length > 0) {
      tweetBody.media = { media_ids: mediaIds };
    }
    
    try { console.log('[api/x/tweet] posting to /2/tweets', { 
      url: 'https://api.x.com/2/tweets',
      method: 'POST',
      body: tweetBody
    }); } catch(_) {}
    
    // forward to X API
    const r = await fetch('https://api.x.com/2/tweets', { 
      method: 'POST', 
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, 
      body: JSON.stringify(tweetBody) 
    });
    const j = await r.json().catch(() => ({}));
    
    try { console.log('[api/x/tweet] X /2/tweets response', {
      status: r.status,
      statusText: r.statusText,
      body: j
    }); } catch(_) {}
    
    if (!r.ok) {
      // Preserve X API status code (429, 503, etc.) for proper error handling
      return res.status(r.status).json({ 
        error: 'x_api_error', 
        status: r.status,
        statusText: r.statusText,
        detail: j 
      });
    }

    // try to extract post id from X response
    const postId = (j && (j.data?.id || j.id || j?.data?.id_str)) ? String(j.data?.id || j.id || j.data?.id_str) : '';
    const now = Math.floor(Date.now() / 1000);

    // If caller provided scheduledPostId, attempt to persist postedAt/postId/status
    let dbUpdateFailed = false;
    let dbUpdateError: string | null = null;
    if (scheduledPostId) {
      try {
        // Security: verify scheduledPostId matches expected user before update
        try {
          const verifyResp = await ddb.send(new GetItemCommand({
            TableName: TBL_X_SCHEDULED,
            Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
            ProjectionExpression: 'PK'
          }));
          const verifyItem: any = (verifyResp as any).Item || {};
          const verifyPk = verifyItem.PK?.S;
          if (verifyPk && verifyPk !== `USER#${userId}`) {
            try { console.error('[api/x/tweet] SECURITY: unauthorized DB update attempt', { expectedPk: `USER#${userId}`, foundPk: verifyPk, scheduledPostId }); } catch(_) {}
            throw new Error('unauthorized_scheduled_post_update');
          }
        } catch (verifyErr: any) {
          if (String(verifyErr).includes('unauthorized')) throw verifyErr;
          // Verification lookup failed, continue with update (will be caught by ConditionExpression)
        }
        
        const names: Record<string,string> = { '#st': 'status' };
        const values: Record<string, any> = {
          ':posted': { S: 'posted' },
          ':ts': { N: String(now) },
          ':f': { BOOL: false }
        };
        const sets: string[] = ['#st = :posted', 'postedAt = :ts'];
        if (postId && postId.trim().length > 0) {
          values[':pid'] = { S: postId };
          sets.push('postId = :pid');
        }
        // Add content and images to the update
        if (text && text.trim().length > 0) {
          values[':content'] = { S: text };
          sets.push('content = :content');
        }
        if (mediaUrls && mediaUrls.length > 0) {
          values[':imgs'] = { S: JSON.stringify(mediaUrls) };
          sets.push('images = :imgs');
        }

        try { console.log('[api/x/tweet] attempting DB update', { scheduledPostId, userId, contentLength: text?.length, imagesCount: mediaUrls?.length, postId }); } catch(_) {}

        // Use the actual SK retrieved from DB at the beginning, not reconstructed one
        const finalUpdateSk = actualSk || `SCHEDULEDPOST#${scheduledPostId}`;
        
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_X_SCHEDULED,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: finalUpdateSk } },
          // Also remove GSI marker so the item is no longer visible to pending queries
          UpdateExpression: `SET ${sets.join(', ')} REMOVE pendingForAutoPostAccount`,
          ConditionExpression: "(attribute_not_exists(#st) OR #st <> :posted) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values
        }));
        
        try { console.log('[api/x/tweet] DB update successful', { scheduledPostId, sk: finalUpdateSk }); } catch(_) {}
      } catch (e: any) {
        dbUpdateFailed = true;
        dbUpdateError = String(e?.message || e);
        try { console.warn('[api/x/tweet] failed to persist scheduled post update', dbUpdateError, { scheduledPostId, userId, errorName: e?.name }); } catch(_) {}
      }
    }

    return res.status(200).json({ 
      ok: true, 
      post: { 
        postId, 
        postedAt: now, 
        postUrl: postId ? `https://x.com/${encodeURIComponent(accountId)}/status/${encodeURIComponent(postId)}` : undefined,
        status: 'posted'
      },
      result: j,
      dbUpdateFailed, 
      dbUpdateError 
    });
  } catch (e: any) { return res.status(500).json({ error: String(e) }); }
}



