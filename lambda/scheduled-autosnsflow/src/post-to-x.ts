import { createDynamoClient } from '@/lib/ddb';
import { PutItemCommand, QueryCommand, UpdateItemCommand, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { streamToBuffer } from '@aws-sdk/util-stream-node';

const ddb = createDynamoClient();
const TBL_X_SCHEDULED = process.env.TBL_X_SCHEDULED || 'XScheduledPosts';
const S3_BUCKET = process.env.S3_MEDIA_BUCKET || '';
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-1';

const s3 = new S3Client({ region: AWS_REGION });

// Helper: Download media from S3 and convert to multipart data for X API
async function getMediaFromS3(s3Url: string): Promise<Buffer | null> {
  try {
    // Parse s3://bucket/key format
    if (!s3Url.startsWith('s3://')) return null;
    const parts = s3Url.slice(5).split('/');
    const bucket = parts[0];
    const key = parts.slice(1).join('/');
    
    const getObjResp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const buffer = await streamToBuffer(getObjResp.Body as any);
    return buffer;
  } catch (e: any) {
    console.error('[x-auto] failed to download media from S3:', e?.message || e);
    return null;
  }
}

// Helper: Upload video to X v2 using chunked upload (Initialize -> Append -> Finalize)
// Follows X API v2 video upload specification with proper endpoints
async function uploadVideoToX(accessToken: string, mediaBuffer: Buffer): Promise<string | null> {
  try {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

    console.info('[x-auto] uploading video with chunked upload', { size: mediaBuffer.length, chunks: Math.ceil(mediaBuffer.length / CHUNK_SIZE) });

    // Step 1: Initialize - Create upload session with JSON body
    // X API v2 spec: POST /2/media/upload/initialize
    const initBody = {
      media_category: 'tweet_video',
      media_type: 'video/mp4',
      total_bytes: mediaBuffer.length,
      shared: false
    };

    console.info('[x-auto] video Initialize request', { 
      url: 'https://api.x.com/2/media/upload/initialize',
      body: initBody
    });

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
      console.error('[x-auto] video Initialize failed', { 
        status: initRes.status,
        title: initData?.title,
        detail: initData?.detail,
        errors: initData?.errors,
        responseBody: initData
      });
      return null;
    }

    console.info('[x-auto] video upload session initialized', { mediaId });

    // Step 2: Append - Send video data in chunks
    // X API v2 spec: POST /2/media/upload/{id}/append with multipart/form-data
    let totalSent = 0;
    for (let i = 0; i < mediaBuffer.length; i += CHUNK_SIZE) {
      const chunk = mediaBuffer.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE);

      console.info('[x-auto] uploading chunk', { chunkIndex, size: chunk.length, totalSent });

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
        console.error('[x-auto] chunk upload failed', { status: appendRes.status, chunk: chunkIndex, errors: errJson?.errors });
        return null;
      }

      totalSent += chunk.length;
    }

    // Step 3: Finalize - Complete upload
    // X API v2 spec: POST /2/media/upload/{id}/finalize (no body)
    console.info('[x-auto] finalizing video upload', { mediaId });

    const finalizeRes = await fetch(`https://api.x.com/2/media/upload/${mediaId}/finalize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const finalizeData = await finalizeRes.json().catch(() => ({})) as any;

    if (!finalizeRes.ok) {
      console.error('[x-auto] video Finalize failed', { status: finalizeRes.status, errors: finalizeData?.errors });
      return null;
    }

    const processingState = finalizeData?.data?.processing_info?.state || 'succeeded';
    console.info('[x-auto] video Finalize completed', { 
      mediaId,
      processingState
    });

    // If processing is pending or in_progress, wait for it to complete
    if (processingState === 'pending' || processingState === 'in_progress') {
      console.info('[x-auto] video encoding in progress, waiting for processing...', { mediaId, initialState: processingState });
      
      const checkAfterSecs = finalizeData?.data?.processing_info?.check_after_secs || 5;
      const success = await waitForVideoProcessing(accessToken, mediaId, processingState, checkAfterSecs);
      
      if (!success) {
        console.error('[x-auto] video processing failed or timeout', { mediaId });
        return null;
      }
    } else if (processingState === 'failed') {
      console.error('[x-auto] video processing failed', { mediaId });
      return null;
    }

    console.info('[x-auto] video uploaded and processed successfully', { mediaId });
    
    return String(mediaId);

  } catch (e: any) {
    console.error('[x-auto] video chunked upload failed:', String(e));
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
      console.error('[x-auto] STATUS request failed', { status: res.status, errors: json?.errors });
      return null;
    }

    const processingInfo = json?.data?.processing_info;
    const state = processingInfo?.state || 'succeeded';
    const checkAfterSecs = processingInfo?.check_after_secs || 5;

    return { state, checkAfterSecs };
  } catch (e: any) {
    console.error('[x-auto] STATUS request error:', String(e));
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
      console.error('[x-auto] video processing timeout', { 
        mediaId, 
        attempts, 
        finalState: state,
        elapsedMs: Date.now() - startTime
      });
      return false;
    }

    console.info('[x-auto] waiting before STATUS check', { 
      mediaId, 
      state, 
      checkAfterSecs, 
      attempts 
    });

    // Wait for the recommended check_after_secs
    await new Promise(resolve => setTimeout(resolve, checkAfterSecs * 1000));

    const status = await getMediaStatus(accessToken, mediaId);
    if (!status) {
      console.warn('[x-auto] STATUS check returned null, retrying...', { attempts });
      checkAfterSecs = 5; // Fallback to 5 seconds
      continue;
    }

    state = status.state;
    checkAfterSecs = status.checkAfterSecs;

    console.info('[x-auto] STATUS check result', { 
      mediaId, 
      state, 
      checkAfterSecs, 
      attempts 
    });

    if (state === 'failed') {
      console.error('[x-auto] video processing failed', { mediaId });
      return false;
    }

    if (state === 'succeeded') {
      console.info('[x-auto] video processing succeeded', { 
        mediaId, 
        attemptsNeeded: attempts 
      });
      return true;
    }
  }

  // Should not reach here, but if state is already succeeded, return true
  return state === 'succeeded';
}

// Helper: Upload image to X and get media_id (v2 API with multipart/form-data)
// Uses X API v2 /2/media/upload endpoint with Bearer token authentication
// Images only - videos use uploadVideoToX instead
async function uploadMediaToX(accessToken: string, mediaBuffer: Buffer, mediaType: string): Promise<string | null> {
  try {
    console.info('[x-auto] uploading image via v2 API:', { 
      mediaSize: mediaBuffer.length,
      mediaType
    });

    // Check if FormData and Blob are available
    let formData: any;
    try {
      if (typeof FormData === 'undefined') {
        console.error('[x-auto] FormData is not defined in this environment');
        throw new Error('FormData is not available in Lambda runtime');
      }
      formData = new FormData();
      console.info('[x-auto] FormData created successfully');
    } catch (e: any) {
      console.error('[x-auto] FormData creation failed:', { 
        error: e?.message || String(e),
        stack: e?.stack,
        formDataAvailable: typeof FormData !== 'undefined',
        blobAvailable: typeof Blob !== 'undefined'
      });
      throw e;
    }

    // Create Blob and append to FormData
    try {
      if (typeof Blob === 'undefined') {
        console.error('[x-auto] Blob is not defined in this environment');
        throw new Error('Blob is not available in Lambda runtime');
      }
      const blob = new Blob([mediaBuffer], { type: mediaType });
      console.info('[x-auto] Blob created successfully', { blobSize: blob.size, blobType: blob.type });
      formData.append('media', blob);
      formData.append('media_type', mediaType);
      formData.append('media_category', 'tweet_image'); // Images only
      console.info('[x-auto] FormData fields appended successfully');
    } catch (e: any) {
      console.error('[x-auto] Blob creation or FormData append failed:', { 
        error: e?.message || String(e),
        stack: e?.stack,
        mediaBufferLength: mediaBuffer.length,
        mediaType
      });
      throw e;
    }

    console.info('[x-auto] sending media upload request to X API v2');
    const uploadRes = await fetch('https://api.x.com/2/media/upload', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        // Note: Do NOT set Content-Type manually; fetch/form-data handles it
      },
      body: formData as any,
    });

    const responseText = await uploadRes.text();
    console.info('[x-auto] media upload v2 response:', { 
      status: uploadRes.status,
      statusText: uploadRes.statusText,
      bodyLength: responseText.length,
      responsePreview: responseText.slice(0, 200)
    });

    if (!uploadRes.ok) {
      console.error('[x-auto] media upload v2 failed response:', {
        status: uploadRes.status,
        statusText: uploadRes.statusText,
        responseBody: responseText.slice(0, 1000),
        headers: Object.fromEntries(uploadRes.headers.entries())
      });
      throw new Error(`Media upload failed: ${uploadRes.status} ${responseText.slice(0, 200)}`);
    }

    let uploadData: any;
    try {
      uploadData = JSON.parse(responseText);
      console.info('[x-auto] parsed upload response JSON successfully');
    } catch (e) {
      console.error('[x-auto] failed to parse v2 response as JSON:', {
        responseText: responseText.slice(0, 500),
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      });
      throw new Error('Invalid JSON response from media upload v2');
    }

    // Check for errors in response
    if (uploadData?.errors) {
      console.error('[x-auto] X API v2 returned errors:', {
        errors: uploadData.errors,
        fullResponse: uploadData
      });
      throw new Error(`X API v2 error: ${JSON.stringify(uploadData.errors)}`);
    }

    // Extract media_id from v2 response (prioritize data.id per X v2 API spec)
    const mediaId = uploadData?.data?.id || uploadData?.media_id_string || uploadData?.media_id;
    if (!mediaId) {
      console.error('[x-auto] no media_id in v2 response:', {
        fullResponse: uploadData,
        dataId: uploadData?.data?.id,
        mediaIdString: uploadData?.media_id_string,
        mediaId: uploadData?.media_id
      });
      throw new Error('No media_id in v2 response');
    }

    console.info('[x-auto] media uploaded successfully via v2:', { 
      mediaId, 
      mediaType, 
      mediaKey: uploadData?.media_key,
      fullResponse: uploadData
    });
    return String(mediaId);
  } catch (e: any) {
    console.error('[x-auto] media upload to X v2 failed:', { 
      err: e?.message || String(e),
      stack: e?.stack,
      name: e?.name,
      mediaType,
      mediaBufferLength: mediaBuffer?.length
    });
    return null;
  }
}

// Helper: Delete media from S3
async function deleteMediaFromS3(s3Url: string): Promise<void> {
  try {
    if (!s3Url.startsWith('s3://')) return;
    const parts = s3Url.slice(5).split('/');
    const bucket = parts[0];
    const key = parts.slice(1).join('/');
    
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.info('[x-auto] deleted media from S3:', s3Url);
  } catch (e: any) {
    console.error('[x-auto] failed to delete media from S3:', e?.message || e);
  }
}

// Main posting function with media support
// Note: Requires clientSecret for OAuth 1.0a media uploads
export async function postToX({ 
  accessToken, 
  text,
  mediaUrls = [],
  clientSecret = '',
  accessTokenSecret = '',
}: { 
  accessToken: string; 
  text: string;
  mediaUrls?: string[];
  clientSecret?: string;
  accessTokenSecret?: string;
}) {
  const mediaIds: string[] = [];

  // Upload media files to X if provided
  if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
    console.info('[x-auto] attempting to upload', mediaUrls.length, 'media files');
    for (const mediaUrl of mediaUrls.slice(0, 4)) { // X API max 4 media per tweet
      try {
        console.info('[x-auto] processing media URL:', mediaUrl);
        const mediaBuffer = await getMediaFromS3(mediaUrl);
        if (!mediaBuffer) {
          console.warn('[x-auto] skipping invalid media URL:', mediaUrl);
          continue;
        }

        // Determine media type and category from S3 URL
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
          console.info('[x-auto] uploading video', { mediaUrl, size: mediaBuffer.length, mediaType });
          mediaId = await uploadVideoToX(accessToken, mediaBuffer);
        } else {
          // Use simple multipart upload for images
          console.info('[x-auto] uploading image', { mediaUrl, size: mediaBuffer.length, mediaType });
          mediaId = await uploadMediaToX(accessToken, mediaBuffer, mediaType);
        }
        
        if (mediaId) {
          mediaIds.push(mediaId);
          console.info('[x-auto] media uploaded to X:', { mediaUrl, mediaId, isVideo });
        } else {
          console.warn('[x-auto] media upload returned null:', mediaUrl);
        }
      } catch (e: any) {
        console.error('[x-auto] error uploading media:', { mediaUrl, err: e?.message || String(e) });
      }
    }
  }
  
  // If media upload failed but we have URLs, log warning
  if (mediaUrls.length > 0 && mediaIds.length === 0) {
    console.warn('[x-auto] WARNING: all media uploads failed, posting text only');
  }

  // Post to X with or without media
  const url = 'https://api.x.com/2/tweets';
  const postBody: any = { text };
  if (mediaIds.length > 0) {
    postBody.media = { media_ids: mediaIds };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(postBody),
  });
  if (!res.ok) throw new Error(`X post failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Fetch due X scheduled posts for an account (uses GSI_PendingByAccount)
export async function fetchDueXScheduledForAccount(accountId: string, nowSec: number, limit = 10) {
  try {
    // Build base params for Query. We'll page through results until we collect up to `limit`
    const baseParams: any = {
      TableName: TBL_X_SCHEDULED,
      IndexName: 'GSI_PendingByAccount',
      KeyConditionExpression: 'pendingForAutoPostAccount = :acc AND scheduledAt <= :now',
      // Filter to only pending and not deleted items (non-key filter)
      FilterExpression: '(attribute_not_exists(#st) OR #st = :pending) AND (attribute_not_exists(isDeleted) OR isDeleted = :f)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':acc': { S: accountId }, ':now': { N: String(nowSec) }, ':pending': { S: 'pending' }, ':f': { BOOL: false } },
      Limit: limit,
    };

    // Page through Query results to account for FilterExpression removing items
    const collectedItems: any[] = [];
    let exclusiveStartKey: any = undefined;
    let page = 0;
    let lastResponse: any = null;
    do {
      const params: any = { ...baseParams };
      if (exclusiveStartKey) params.ExclusiveStartKey = exclusiveStartKey;
      lastResponse = await ddb.send(new QueryCommand(params));
      page++;
      const pageItems = (lastResponse as any).Items || [];
      if (pageItems.length) collectedItems.push(...pageItems);
      exclusiveStartKey = (lastResponse as any).LastEvaluatedKey;
      // continue until we have enough post-filtered items or no more pages
    } while (collectedItems.length < limit && exclusiveStartKey);

    // minimal logging: only counts to avoid verbose output in production
    try { console.info('[x-auto] fetchedPendingCandidates', { accountId, nowSec, returned: collectedItems.length }); } catch(_) {}
    return collectedItems || [];
  } catch (e) {
    throw e;
  }
}

// Alternate fetch: use GSI_ByAccount then filter client-side (closer to Threads approach)
export async function fetchDueXScheduledForAccountByAccount(accountId: string, nowSec: number, limit = 10) {
  try {
    const params: any = {
      TableName: TBL_X_SCHEDULED,
      IndexName: 'GSI_ByAccount',
      KeyConditionExpression: 'accountId = :acc AND scheduledAt <= :now',
      ExpressionAttributeValues: { ':acc': { S: accountId }, ':now': { N: String(nowSec) } },
      // retrieve a reasonable page to allow client-side filtering
      Limit: Math.max(100, limit * 5),
    };
    try { console.info('[x-auto] queryByAccountParams', { accountId, nowSec, params: { KeyConditionExpression: params.KeyConditionExpression, ExpressionAttributeValues: JSON.stringify(params.ExpressionAttributeValues), Limit: params.Limit } }); } catch (_) {}
    const q = await ddb.send(new QueryCommand(params));
    try { console.info('[x-auto] rawQueryByAccountResponse', { accountId, raw: JSON.stringify(q) }); } catch (_) {}
    const items: any[] = (q as any).Items || [];
    const filtered = items.filter((it: any) => {
      const st = it.status?.S || '';
      const isDeleted = it.isDeleted?.BOOL === true;
      // treat missing status as pending; also accept 'scheduled' created by Hourly
      const isPending = (!st || st === 'pending' || st === 'scheduled');
      return isPending && !isDeleted && (Number(it.scheduledAt?.N || 0) <= Number(nowSec));
    }).slice(0, limit);
    try { console.info('[x-auto] fetchedByAccountFiltered', { accountId, nowSec, returned: filtered.length }); } catch(_) {}
    return filtered;
  } catch (e) {
    throw e;
  }
}

// Fetch due X scheduled posts for an account restricted to a specific JST date (scheduledDateYmd).
export async function fetchDueXScheduledForAccountByAccountForDate(accountId: string, nowSec: number, scheduledDateYmd: string, limit = 10) {
  try {
    const params: any = {
      TableName: TBL_X_SCHEDULED,
      IndexName: 'GSI_PendingByAccountDate', // new GSI: accountId + scheduledDateYmd
      KeyConditionExpression: 'accountId = :acc AND scheduledDateYmd = :ymd',
      ExpressionAttributeValues: { ':acc': { S: accountId }, ':ymd': { S: scheduledDateYmd } },
      Limit: Math.max(100, limit * 5),
    };
    try { console.info('[x-auto] queryByAccountDateParams', { accountId, nowSec, scheduledDateYmd, params: { KeyConditionExpression: params.KeyConditionExpression, ExpressionAttributeValues: JSON.stringify(params.ExpressionAttributeValues), Limit: params.Limit } }); } catch (_) {}
    const q = await ddb.send(new QueryCommand(params));
    try { console.info('[x-auto] rawQueryByAccountDateResponse', { accountId, raw: JSON.stringify(q) }); } catch (_) {}
    const items: any[] = (q as any).Items || [];
    const filtered = items.filter((it: any) => {
      const st = it.status?.S || '';
      const isDeleted = it.isDeleted?.BOOL === true;
      const isPending = (!st || st === 'pending' || st === 'scheduled');
      return isPending && !isDeleted && (Number(it.scheduledAt?.N || 0) <= Number(nowSec));
    }).slice(0, limit);
    try { console.info('[x-auto] fetchedByAccountDateFiltered', { accountId, nowSec, scheduledDateYmd, returned: filtered.length }); } catch(_) {}
    return filtered;
  } catch (e) {
    throw e;
  }
}

// Mark scheduled item as posted (update postedAt/status/postId)
export async function markXScheduledPosted(pk: string, sk: string, postId: string, accountId?: string) {
  const now = Math.floor(Date.now() / 1000);
  // Build update expression dynamically to include postUrl when accountId is provided
  const exprParts: string[] = ['#st = :posted', 'postedAt = :ts', 'postId = :pid'];
  const names: any = { '#st': 'status' };
  const values: any = { ':posted': { S: 'posted' }, ':ts': { N: String(now) }, ':pid': { S: postId } };
  if (accountId && String(accountId).trim().length > 0) {
    // prefer modern x.com permalink
    const purl = `https://x.com/${encodeURIComponent(String(accountId))}/status/${encodeURIComponent(String(postId))}`;
    exprParts.push('postUrl = :purl');
    values[':purl'] = { S: purl };
  }
  const updateExpr = `SET ${exprParts.join(', ')} REMOVE pendingForAutoPostAccount`;
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_X_SCHEDULED,
      Key: { PK: { S: pk }, SK: { S: sk } },
      UpdateExpression: updateExpr,
      ConditionExpression: 'attribute_not_exists(postId)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  } catch (e: any) {
    // If conditional check failed it means another worker already posted this item — treat as ok.
    if (e && (e.name === 'ConditionalCheckFailedException' || (String(e).includes && String(e).includes('ConditionalCheckFailed')))) {
      try { console.info('[x-auto] markXScheduledPosted skipped: already posted by another worker', { pk, sk, postId }); } catch(_) {}
      return;
    }
    throw e;
  }
}

// Skeleton runner to be invoked by the 5-min job per account
export async function runAutoPostForXAccount(acct: any, userId: string) {
  // acct must include oauthAccessToken (use refresh logic elsewhere)
  if (!acct || !acct.autoPostEnabled) return { posted: 0 };
  const now = Math.floor(Date.now() / 1000);
  const accountId = acct.accountId;
  // Use account-date-based fetch to restrict to today's scheduledDateYmd and reduce stale candidates
  const toJstYmd = (sec: number) => {
    const d = new Date(sec * 1000 + 9 * 3600 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${dd}`;
  };
  const todayYmd = toJstYmd(now);
  const fetchLimit = 3;
  const candidates = await fetchDueXScheduledForAccountByAccountForDate(accountId, now, todayYmd, fetchLimit);
  try { console.info('[x-auto] nowSec', { userId, accountId, now }); } catch(_) {}
  let postedCount = 0;
  const debug: any = { candidates: (candidates || []).length, tokenPresent: !!(acct.oauthAccessToken || acct.accessToken), errors: [] };
  try { console.info('[x-auto] fetched candidates', { userId, accountId, candidateCount: debug.candidates }); } catch(_) {}
  const maxPostsPerAccount = 1;
  for (const it of candidates) {
    try {
      const pk = it.PK.S; const sk = it.SK.S;
      const content = it.content.S || '';
      // Verbose candidate inspection for diagnostics
      try { console.info('[x-auto] candidate inspect', { userId, accountId, pk, sk, status: it.status?.S || null, contentPresent: !!(it.content && it.content.S), scheduledAt: it.scheduledAt?.N || null, timeRange: it.timeRange?.S || null, poolType: it.poolType?.S || null }); } catch(_) {}
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_CAND_ITEM', payload: { accountId: accountId, pk, sk, status: it.status?.S || null, content: (it.content && it.content.S) || null, scheduledAt: Number(it.scheduledAt?.N || 0), timeRange: it.timeRange?.S || null, poolType: it.poolType?.S || null } }); } catch(_) {}
      // Prevent double-posting: ensure status is pending or scheduled (hourly creates 'scheduled')
      if ((it.status && it.status.S) && it.status.S !== 'pending' && it.status.S !== 'scheduled') {
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_SKIP_STATUS', payload: { accountId, pk, sk, status: it.status.S } }); } catch(_) {}
        continue;
      }
      // Time-range expiry check: skip items whose scheduled time window has passed
      try {
        const scheduledAtSec = Number(it.scheduledAt?.N || 0);
        const timeRangeStr = it.timeRange?.S || '';
        if (timeRangeStr && scheduledAtSec > 0) {
          const endEpoch = (() => {
            try {
              const parts = String(timeRangeStr).split(/-|～|~/).map((x: any) => String(x).trim());
              const endPart = parts[1] || '';
              if (!endPart) return null;
              const hhmm = endPart.split(':').map((x: any) => Number(x));
              if (!Array.isArray(hhmm) || hhmm.length < 2 || !Number.isFinite(hhmm[0]) || !Number.isFinite(hhmm[1])) return null;
              const endHour = Number(hhmm[0]) || 0;
              const endMin = Number(hhmm[1]) || 0;
              // Convert scheduledAtSec to JST midnight ms
              const baseMs = scheduledAtSec * 1000;
              const jstBaseMs = baseMs + (9 * 3600 * 1000);
              const jstDate = new Date(jstBaseMs);
              // start of JST day (midnight) in epoch ms
              const jstStartOfDayMs = Date.UTC(jstDate.getUTCFullYear(), jstDate.getUTCMonth(), jstDate.getUTCDate(), 0, 0, 0);
              const endMsJst = jstStartOfDayMs + (endHour * 3600 + endMin * 60) * 1000 + 59 * 1000;
              const endMsEpoch = endMsJst - (9 * 3600 * 1000);
              return Math.floor(endMsEpoch / 1000);
            } catch (_) { return null; }
          })();
          if (endEpoch && now > endEpoch) {
            // mark expired (only if still pending) and skip
            try {
              await ddb.send(new UpdateItemCommand({
                TableName: TBL_X_SCHEDULED,
                Key: { PK: { S: pk }, SK: { S: sk } },
                UpdateExpression: 'SET #st = :expired, expiredAt = :ts, expireReason = :rsn',
                ConditionExpression: 'attribute_not_exists(#st) OR #st = :pending',
                ExpressionAttributeNames: { '#st': 'status' },
                ExpressionAttributeValues: { ':expired': { S: 'expired' }, ':pending': { S: 'pending' }, ':ts': { N: String(now) }, ':rsn': { S: 'time-window-passed' } },
              }));
            } catch (_) {}
            try { await putLog({ userId, type: "auto-post", accountId, targetId: sk, status: "skip", message: "timeRange passed, expired" }); } catch(_) {}
            try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_EXPIRED_SKIPPED', payload: { accountId, pk, sk, scheduledAt: scheduledAtSec, endEpoch, now } }); } catch(_) {}
            continue;
          }
        }
      } catch (_) {}
      // Try posting, attempt refresh once on failure
      let accessToken = acct.oauthAccessToken || acct.accessToken || '';
      let r;
      // If content is empty, try to claim from PostPool and attach to this scheduled record
      let postText = String(content || '');
      if (!postText) {
        try {
          const TBL_POOL = process.env.TBL_POST_POOL || 'PostPool';
          const poolType = acct.type || 'general';
          try { console.info('[x-auto] pool query params', { userId, accountId, TBL_POOL, poolType }); } catch(_) {}
          try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_PARAMS', payload: { accountId: accountId, TBL_POOL, poolType } }); } catch(_) {}
          const pq = await ddb.send(new QueryCommand({
            TableName: TBL_POOL,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
            ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'POOL#' } },
            Limit: 50,
          }));
          const pitems: any[] = (pq as any).Items || [];
          try { console.info('[x-auto] pool raw items count', { userId, accountId, count: (pitems || []).length }); } catch(_) {}
          try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_RAW_COUNT', payload: { accountId: accountId, count: (pitems || []).length } }); } catch(_) {}
          const pcands = pitems.map(itm => ({
            pk: itm.PK,
            sk: itm.SK,
            poolId: itm.poolId?.S || (itm.SK?.S || '').replace(/^POOL#/, ''),
            type: itm.type?.S || 'general',
            content: itm.content?.S || '',
            images: itm.images?.S ? JSON.parse(itm.images.S) : [],
            createdAt: itm.createdAt?.N ? Number(itm.createdAt.N) : 0,
          })).filter(x => (x.type || 'general') === poolType);
          // determine reuse setting for this user/type from UserTypeTimeSettings table
          const TBL_USER_TYPE_TIME_SETTINGS = process.env.TBL_USER_TYPE_TIME_SETTINGS || 'UserTypeTimeSettings';
          let reuse = false;
          try {
            const us = await ddb.send(new GetItemCommand({ TableName: TBL_USER_TYPE_TIME_SETTINGS, Key: { user_id: { S: String(userId) }, type: { S: String(poolType) } }, ProjectionExpression: 'reuse' }));
            const uit: any = (us as any).Item || {};
            reuse = Boolean(uit.reuse && (uit.reuse.BOOL === true || String(uit.reuse.S) === 'true'));
          } catch (_) { reuse = false; }

          if (pcands.length) {
            try { console.info('[x-auto] pool query result', { userId, accountId, candidateCount: pcands.length }); } catch(_) {}
            try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_QUERY', payload: { accountId: acct.accountId, candidateCount: pcands.length, poolType } }); } catch(_) {}
            // shuffle candidates to randomize order
            for (let i = pcands.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              const tmp = pcands[i]; pcands[i] = pcands[j]; pcands[j] = tmp;
            }
            try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_CANDS', payload: { accountId: acct.accountId, poolIds: pcands.map(p => p.poolId).slice(0,10) } }); } catch(_) {}
            if (reuse) {
              // Reuse mode: pick up to two candidates and avoid matching account's last posted content
              let chosen: any = null;
              const first = pcands[0];
              if (pcands.length >= 2) {
                const second = pcands[1];
                // fetch last posted content for accountId
                let lastPostedContent = '';
                try {
                  const q = await ddb.send(new QueryCommand({ TableName: TBL_X_SCHEDULED, IndexName: 'GSI_ByAccount', KeyConditionExpression: 'accountId = :acc', ExpressionAttributeValues: { ':acc': { S: accountId } }, Limit: 50 }));
                  const items: any[] = (q as any).Items || [];
                  const postedItems = items.filter(itm => (itm.status && itm.status.S === 'posted') && (itm.postedAt || itm.postedAt?.N));
                  if (postedItems.length) {
                    // pick the one with max postedAt
                    postedItems.sort((a,b) => Number(b.postedAt?.N || 0) - Number(a.postedAt?.N || 0));
                    lastPostedContent = postedItems[0].content?.S || '';
                  }
                } catch (_) { lastPostedContent = ''; }
                if (first.content && String(first.content) === String(lastPostedContent) && second.content && String(second.content) !== String(lastPostedContent)) {
                  chosen = second;
                } else {
                  chosen = first;
                }
              } else {
                chosen = first;
              }
              if (chosen) {
                try {
                  const claimedImages = chosen.images || [];
                  postText = String(chosen.content || '');
                  // attach claimed content to scheduled record WITHOUT deleting pool item
                  const nowTs = Math.floor(Date.now() / 1000);
                  await ddb.send(new UpdateItemCommand({
                    TableName: TBL_X_SCHEDULED,
                    Key: { PK: { S: pk }, SK: { S: sk } },
                    UpdateExpression: 'SET content = :c, images = :imgs, updatedAt = :now',
                    ExpressionAttributeValues: { ':c': { S: String(postText) }, ':imgs': { S: JSON.stringify(claimedImages || []) }, ':now': { N: String(nowTs) } },
                  }));
                  try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_REUSE_CHOSEN', payload: { accountId: acct.accountId, poolId: chosen.poolId, contentSnippet: String(postText || '').slice(0,120) } }); } catch(_) {}
                } catch (e:any) {
                  try { console.warn('[warn] attach reused pool content to XScheduled failed', { userId, accountId: sk, err: String(e) }); } catch(_) {}
                }
              }
            } else {
              // consume mode: attempt atomic delete for candidates
              for (const cand of pcands) {
                try {
                  try { console.info('[x-auto] attempting pool claim', { userId, accountId: acct.accountId, poolId: cand.poolId }); } catch(_) {}
                  try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_ATTEMPT_CLAIM', payload: { accountId: acct.accountId, poolId: cand.poolId } }); } catch(_) {}
                  const delRes: any = await ddb.send(new DeleteItemCommand({
                    TableName: TBL_POOL,
                    Key: { PK: { S: String(cand.pk.S) }, SK: { S: String(cand.sk.S) } },
                    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
                    ReturnValues: 'ALL_OLD',
                  }));
                  const attrs = delRes && delRes.Attributes ? delRes.Attributes : null;
                  if (attrs) {
                    postText = (typeof getS === 'function' ? getS(attrs.content) : (attrs.content && attrs.content.S) ) || cand.content || '';
                    let claimedImages: any[] = [];
                    try { claimedImages = attrs.images ? (typeof getS === 'function' ? JSON.parse(getS(attrs.images)) : (attrs.images && JSON.parse(attrs.images.S))) : (cand.images || []); } catch(_) { claimedImages = (cand.images || []); }
                    try { console.info('[x-auto] pool claim success', { userId, accountId: acct.accountId, poolId: cand.poolId, contentSnippet: String(postText || '').slice(0,120) }); } catch(_) {}
                    try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_CLAIMED', payload: { accountId: acct.accountId, poolId: cand.poolId, contentSnippet: String(postText || '').slice(0,120), imagesCount: (claimedImages || []).length } }); } catch(_) {}
                    // attach claimed content to the scheduled record
                    try {
                      const nowTs = Math.floor(Date.now() / 1000);
                      await ddb.send(new UpdateItemCommand({
                        TableName: TBL_X_SCHEDULED,
                        Key: { PK: { S: pk }, SK: { S: sk } },
                        UpdateExpression: 'SET content = :c, images = :imgs, updatedAt = :now',
                        ExpressionAttributeValues: { ':c': { S: String(postText) }, ':imgs': { S: JSON.stringify(claimedImages || []) }, ':now': { N: String(nowTs) } },
                      }));
                      try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_ATTACH_OK', payload: { accountId: acct.accountId, scheduledId: sk, poolId: cand.poolId } }); } catch(_) {}
                    } catch (e:any) {
                      try { console.warn('[warn] attach claimed pool content to XScheduled failed', { userId, accountId: sk, err: String(e) }); } catch(_) {}
                      try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_ATTACH_ERR', payload: { accountId: acct.accountId, scheduledId: sk, poolId: cand.poolId, err: String(e) } }); } catch(_) {}
                    }
                    // record that we claimed one and break
                    break;
                  }
                } catch (e:any) {
                  // failed to claim this candidate (race), try next
                  try { console.info('[x-auto] pool claim failed for candidate, trying next', { accountId: acct.accountId, poolId: cand.poolId, err: String(e) }); } catch(_) {}
                  try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_POOL_CLAIM_FAILED', payload: { accountId: acct.accountId, poolId: cand.poolId, err: String(e) } }); } catch(_) {}
                  continue;
                }
              }
            }
          }
        } catch (e:any) {
          try { console.info('[info] claim pool for scheduled failed', { userId, accountId, err: String(e) }); } catch(_) {}
        }
      }
      try {
        // If postText is still empty after attempting to claim from pool, skip posting.
        if (!postText || String(postText).trim() === "") {
          try { console.info('[x-auto] skip post: empty content after pool claim', { userId, accountId, pk, sk }); } catch(_) {}
          try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_X_SKIP_NO_CONTENT', payload: { accountId, pk, sk } }); } catch(_) {}
          continue;
        }
        // Extract media URLs from the scheduled post item (attached by pool claim or initial setup)
        const mediaUrls: string[] = [];
        if (it.images && it.images.S) {
          try {
            const imgs = JSON.parse(it.images.S);
            if (Array.isArray(imgs)) {
              mediaUrls.push(...imgs);
            }
          } catch (_) {}
        }
        r = await postToX({ accessToken, text: postText, mediaUrls });
      } catch (postErr) {
        // Try token refresh using stored refreshToken
        try {
          const newToken = await refreshXAccountToken(userId, accountId);
          if (newToken) {
            accessToken = newToken;
            // Extract media URLs again for retry
            const mediaUrls: string[] = [];
            if (it.images && it.images.S) {
              try {
                const imgs = JSON.parse(it.images.S);
                if (Array.isArray(imgs)) {
                  mediaUrls.push(...imgs);
                }
              } catch (_) {}
            }
            r = await postToX({ accessToken, text: content, mediaUrls });
          } else {
            // mark permanent failure on 403-like errors
            try {
              const errStr = String(postErr || '');
              if (/\\b403\\b|Forbidden|duplicate/i.test(errStr)) {
                try {
                  await ddb.send(new UpdateItemCommand({
                    TableName: TBL_X_SCHEDULED,
                    Key: { PK: { S: pk }, SK: { S: sk } },
                    UpdateExpression: 'SET permanentFailure = :t, lastPostError = :err',
                    ExpressionAttributeValues: { ':t': { BOOL: true }, ':err': { S: errStr } },
                  }));
                } catch (_) {}
              }
            } catch (_) {}
            throw postErr;
          }
        } catch (refreshErr) {
          // capture error and continue to next candidate
          try { console.warn('[x-auto] post failed and refresh failed', { userId, accountId, sk, err: String(postErr) }); } catch(_) {}
          debug.errors.push({ sk, err: String(postErr) });
          // also mark permanent failure when response indicates duplicate/403
          try {
            const errStr = String(postErr || '');
            if (/\\b403\\b|Forbidden|duplicate/i.test(errStr)) {
              try {
                await ddb.send(new UpdateItemCommand({
                  TableName: TBL_X_SCHEDULED,
                  Key: { PK: { S: pk }, SK: { S: sk } },
                  UpdateExpression: 'SET permanentFailure = :t, lastPostError = :err',
                  ExpressionAttributeValues: { ':t': { BOOL: true }, ':err': { S: errStr } },
                }));
              } catch (_) {}
            }
          } catch (_) {}
          continue;
        }
      }
      // debug: log post response body for observability (do not log tokens)
      try { console.info('[x-auto] post response', { userId, accountId, sk, response: r }); } catch(_) {}

      const postId = (r && r.data && (r.data.id || r.data?.id_str)) || '';
      if (!postId || String(postId).trim() === '') {
        try { console.warn('[x-auto] post returned no postId', { userId, accountId, sk, response: r }); } catch(_) {}
        debug.errors.push({ sk, err: 'no_post_id', response: r });
        continue;
      }

      try {
        await markXScheduledPosted(pk, sk, String(postId), accountId);
      } catch (e) {
        try { console.warn('[x-auto] markXScheduledPosted failed', { userId, accountId, sk, err: String(e) }); } catch(_) {}
        debug.errors.push({ sk, err: String(e) });
        continue;
      }
      postedCount++;
      // honor per-account posting limit for this run
      if (postedCount >= maxPostsPerAccount) {
        try { console.info('[x-auto] reached maxPostsPerAccount, stopping further posts for this account', { userId, accountId, maxPostsPerAccount }); } catch(_) {}
        break;
      }
      // notify user-level discord webhooks only if user has enableX=true in settings
      try {
        const settingsOut = await ddb.send(new GetItemCommand({ TableName: process.env.TBL_SETTINGS || 'UserSettings', Key: { PK: { S: `USER#${userId}` }, SK: { S: 'SETTINGS' } }, ProjectionExpression: 'enableX' }));
        const enableX = Boolean(settingsOut?.Item?.enableX?.BOOL === true);
        const userContent = `【X 投稿】アカウント ${accountId} にて予約投稿が実行されました\npostId: ${postId}\ncontent: ${String(content).slice(0,200)}`;
        if (enableX) {
          try { await postDiscordLog({ userId, content: userContent }); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        // log but don't fail posting
        try { console.warn('[warn] check enableX or postDiscordLog failed', String(e)); } catch(_) {}
      }
      // notify master webhook (always)
      try { await postDiscordMaster(`**[X POSTED]** user=${userId} account=${accountId} postId=${postId}\n${String(content).slice(0,200)}`); } catch(e) {}
    } catch (e) {
      try { console.warn('[x-auto] runAutoPostForXAccount item failed', { userId, accountId, err: String(e) }); } catch(_) {}
      debug.errors.push({ err: String(e) });
      // mark permanent failure on 403/duplicate
      try {
        const errStr = String(e || '');
        if (/\\b403\\b|Forbidden|duplicate/i.test(errStr)) {
          try {
            await ddb.send(new UpdateItemCommand({
              TableName: TBL_X_SCHEDULED,
              Key: { PK: { S: pk }, SK: { S: sk } },
              UpdateExpression: 'SET permanentFailure = :t, lastPostError = :err',
              ExpressionAttributeValues: { ':t': { BOOL: true }, ':err': { S: errStr } },
            }));
          } catch (_) {}
        }
      } catch (_) {}
      // continue with next candidate
      continue;
    }
  }
  // If there are collected errors, log them verbosely for debugging
  try {
    if (debug && Array.isArray(debug.errors) && debug.errors.length > 0) {
      try { console.info('[x-auto] runAutoPostForXAccount debug.errors', { userId, accountId, errors: debug.errors }); } catch(_) {}
    }
  } catch (_) {}
  return { posted: postedCount, debug };
}

// Consume one PostPool item for this user/account and post it to X.
export async function postFromPoolForAccount(userId: string, acct: any, opts: { dryRun?: boolean, lockTtlSec?: number } = {}) {
  console.info('[x-auto] postFromPoolForAccount called', { userId, accountId: acct?.accountId, poolType: acct?.type, dryRun: !!opts.dryRun });
  const TBL_POOL = process.env.TBL_POST_POOL || 'PostPool';
  const now = Math.floor(Date.now() / 1000);
  const lockTtl = Number(opts.lockTtlSec || 600);
  const accountId = acct.accountId;
  const poolType = acct.type || 'general';
  const debug: any = { tried: 0, posted: 0, errors: [] };

  // 1) Query pool items for this user and poolType
  try {
    console.info('[x-auto] querying PostPool', { userId, poolType, TBL_POOL });
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_POOL,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'POOL#' } },
      Limit: 50,
    }));
    const items: any[] = (q as any).Items || [];
    console.info('[x-auto] PostPool query result', { userId, poolType, itemsCount: items.length });
    // filter by poolType
    const candidates = items.map(it => ({
      pk: it.PK,
      sk: it.SK,
      poolId: it.poolId?.S || (it.SK?.S || '').replace(/^POOL#/, ''),
      type: it.type?.S || 'general',
      content: it.content?.S || '',
      images: it.images?.S ? JSON.parse(it.images.S) : [],
      createdAt: it.createdAt?.N ? Number(it.createdAt.N) : 0,
    })).filter(x => (x.type || 'general') === poolType);

    console.info('[x-auto] PostPool candidates after filtering', { userId, poolType, candidatesCount: candidates.length, candidates: candidates.map(c => ({ poolId: c.poolId, hasContent: !!c.content, imagesCount: (c.images || []).length })) });

    if (!candidates.length) {
      console.warn('[x-auto] no pool items found for user/poolType', { userId, poolType });
      return { posted: 0, debug: { reason: 'no_pool_items' } };
    }

    // choose random candidate among same-user & same-type pool items
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }
    const cand = candidates[0];
    debug.tried = 1;

    // If dryRun requested, do not acquire locks or modify DB — just report the candidate.
    if (opts.dryRun || (global as any).__TEST_CAPTURE__) {
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'DRYRUN_POST_FROM_POOL', payload: { userId, accountId, poolId: cand.poolId } }); } catch(_) {}
      return { posted: 0, debug: { dryRun: true, poolId: cand.poolId } };
    }

    // 2) Atomically claim (delete) a pool item for this candidate list.
    let claimedFromPool: any = null;
    for (const candidate of candidates) {
      try {
        const delRes: any = await ddb.send(new DeleteItemCommand({
          TableName: TBL_POOL,
          Key: { PK: { S: String(candidate.pk.S) }, SK: { S: String(candidate.sk.S) } },
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
          ReturnValues: 'ALL_OLD',
        }));
        const attrs = delRes && delRes.Attributes ? delRes.Attributes : null;
        if (attrs) {
          claimedFromPool = {
            poolId: candidate.poolId,
            content: getS(attrs.content) || candidate.content || "",
            images: attrs.images ? (getS(attrs.images) ? JSON.parse(getS(attrs.images)) : []) : (candidate.images || []),
          };
          // set cand to the claimed one for downstream logging/usage
          Object.assign(cand, candidate);
          break;
        }
      } catch (e:any) {
        // failed to claim this candidate (race) - try next
        continue;
      }
    }
    if (!claimedFromPool) {
      // nobody claimable
      debug.errors.push({ err: 'no_claimable_pool_item' });
      return { posted: 0, debug };
    }

    // Note: Do not create new XScheduledPosts records here. 5min flow should update existing scheduled posts only.

    // 4) perform post using acct tokens (try refresh on failure)
    try {
      console.info('[x-auto] preparing to post to X', { userId, accountId, contentLength: (cand.content || '').length, mediaUrlsCount: (claimedFromPool.images || []).length, mediaUrls: claimedFromPool.images });
      let accessToken = acct.oauthAccessToken || acct.accessToken || '';
      let resp;
      const mediaUrls = (claimedFromPool.images || []) as string[];
      console.info('[x-auto] calling postToX', { userId, accountId, hasAccessToken: !!accessToken, textLength: (cand.content || '').length, mediaUrlsCount: mediaUrls.length });
      try {
        resp = await postToX({ accessToken, text: cand.content || '', mediaUrls });
        console.info('[x-auto] postToX succeeded', { userId, accountId, response: resp });
      } catch (postErr:any) {
        console.error('[x-auto] postToX failed, attempting token refresh', { userId, accountId, error: postErr?.message || String(postErr), stack: postErr?.stack });
        // try refresh
        const newToken = await refreshXAccountToken(userId, accountId);
        if (newToken) {
          console.info('[x-auto] token refreshed, retrying postToX', { userId, accountId });
          accessToken = newToken;
          resp = await postToX({ accessToken, text: cand.content || '', mediaUrls });
          console.info('[x-auto] postToX succeeded after token refresh', { userId, accountId, response: resp });
        } else {
          console.error('[x-auto] token refresh failed, throwing original error', { userId, accountId });
          throw postErr;
        }
      }
      const postId = (resp && resp.data && (resp.data.id || resp.data.id_str)) || '';
      if (!postId) throw new Error('no_post_id');

      // 5) Delete media from S3 if reuse setting is disabled
      // Check reuse setting for this pool type
      let shouldDeleteMedia = true;
      try {
        const TBL_USER_TYPE_TIME_SETTINGS = process.env.TBL_USER_TYPE_TIME_SETTINGS || 'UserTypeTimeSettings';
        const uts = await ddb.send(new GetItemCommand({
          TableName: TBL_USER_TYPE_TIME_SETTINGS,
          Key: { user_id: { S: String(userId) }, type: { S: String(poolType) } },
          ProjectionExpression: 'reuse',
        }));
        const uit: any = (uts as any).Item || {};
        shouldDeleteMedia = !Boolean(uit.reuse && (uit.reuse.BOOL === true || String(uit.reuse.S) === 'true'));
      } catch (_) {
        shouldDeleteMedia = true; // default to delete if setting lookup fails
      }

      // Delete media files from S3 if not reusing
      if (shouldDeleteMedia && mediaUrls.length > 0) {
        for (const mediaUrl of mediaUrls) {
          try {
            await deleteMediaFromS3(mediaUrl);
          } catch (e: any) {
            console.error('[x-auto] error deleting media after post:', e?.message || e);
          }
        }
      }

      // 5min flow updates the existing scheduled record (TBL_SCHEDULED) elsewhere; do not create/update separate XScheduledPosts here.

      // 6) write ExecutionLogs / Discord notification (reuse postDiscordMaster if available globally)
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'POST_FROM_POOL_RESULT', payload: { userId, accountId, poolId: cand.poolId, postId } }); } catch(_) {}
      try { await postDiscordMaster(`**[X POST FROM POOL]** user=${userId} account=${accountId} poolId=${cand.poolId} postId=${postId}\n${String(cand.content || '').slice(0,200)}`); } catch(_) {}

      debug.posted = 1;
      console.info('[x-auto] postFromPoolForAccount succeeded', { userId, accountId, postId, poolId: cand.poolId });
      return { posted: 1, debug, postId };
    } catch (e:any) {
      console.error('[x-auto] postFromPoolForAccount posting failed', { 
        userId, 
        accountId, 
        error: e?.message || String(e),
        stack: e?.stack,
        name: e?.name
      });
      debug.errors.push({ err: String(e), stack: e?.stack, name: e?.name });
      // Do not create/update XScheduledPosts here on failure; 5min reservation updates are handled by the calling flow.
      // release lock
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_POOL,
          Key: { PK: { S: String(cand.pk.S) }, SK: { S: String(cand.sk.S) } },
          UpdateExpression: 'REMOVE postingLockOwner, postingLockExpiresAt',
        }));
      } catch (_) {}
      return { posted: 0, debug };
    }
  } catch (e:any) {
    console.error('[x-auto] postFromPoolForAccount outer catch failed', { 
      userId, 
      accountId, 
      error: e?.message || String(e),
      stack: e?.stack,
      name: e?.name
    });
    return { posted: 0, debug: { err: String(e), stack: e?.stack, name: e?.name } };
  }
}

// Refresh a single X account token using stored refresh_token and client credentials
async function refreshXAccountToken(userId: string, accountId: string) {
  const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';
  try {
    const out = await ddb.send(new GetItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
    const it: any = (out as any).Item || {};
    const clientId = it.clientId?.S || it.client_id?.S || '';
    const clientSecret = it.clientSecret?.S || it.client_secret?.S || '';
    const refreshToken = it.refreshToken?.S || it.oauthRefreshToken?.S || '';
    if (!refreshToken) return null;
    const tokenUrl = 'https://api.x.com/2/oauth2/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    if (clientId && !clientSecret) params.append('client_id', clientId);
    const headers: any = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (clientId && clientSecret) headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const resp = await fetch(tokenUrl, { method: 'POST', headers, body: params });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.access_token) return null;
    const at = String(j.access_token || '');
    const rt = String(j.refresh_token || refreshToken);
    const expiresIn = Number(j.expires_in || 0);
    const expiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : 0;
    try {
      await ddb.send(new UpdateItemCommand({ TableName: TBL_X, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET oauthAccessToken = :at, refreshToken = :rt, oauthTokenExpiresAt = :exp, oauthSavedAt = :now', ExpressionAttributeValues: { ':at': { S: at }, ':rt': { S: rt }, ':exp': { N: String(expiresAt || 0) }, ':now': { N: String(Math.floor(Date.now() / 1000)) } } }));
    } catch (_) {}
    return at;
  } catch (e) {
    return null;
  }
}


