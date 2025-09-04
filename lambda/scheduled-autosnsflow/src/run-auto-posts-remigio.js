// Lambda-compatible test handler to simulate/execute auto-posts for a specific account
// Usage (Lambda test event JSON): { "accountId": "remigiozarcorb618", "limit": 10, "dryRun": true }
const { DynamoDBClient, QueryCommand, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const crypto = require("crypto");

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const ddb = new DynamoDBClient({ region: REGION });
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_THREADS = "ThreadsAccounts";

exports.handler = async function (event) {
  try {
    const accountId = (event && event.accountId) || (event && event.body && JSON.parse(event.body).accountId) || "remigiozarcorb618";
    const limit = Number((event && event.limit) || (event && event.body && JSON.parse(event.body).limit) || 10);
    const dryRun = typeof event.dryRun !== "undefined" ? !!event.dryRun : (event && event.body && JSON.parse(event.body || "{}").dryRun) || false;

    const now = Math.floor(Date.now() / 1000);

    // Query scheduled posts for user (we don't know USER# value here; assume environment or single-tenant test)
    // For test use, we'll iterate all users' scheduled posts and filter by accountId
    // KeyConditionExpression requires a PK; for Lambda test we scan with Query across all USER# keys is hard,
    // so we will perform a Scan-like Query by using a Query with begins_with SK and filter by accountId.
    // Note: This function is intended for debugging in a controlled environment.

    // For simplicity, ask caller to provide userId if available
    const userId = event.userId || process.env.TEST_USER_ID;
    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: "userId required (set in event.userId or env TEST_USER_ID)" }) };
    }

    const params = {
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: "SCHEDULEDPOST#" }, ":acc": { S: accountId }, ":f": { BOOL: false }, ":now": { N: String(now) }, ":sch": { S: "scheduled" } },
      FilterExpression: "accountId = :acc AND (attribute_not_exists(#st) OR #st = :sch) AND (attribute_not_exists(#del) OR #del = :f) AND #sa <= :now",
      ProjectionExpression: "SK, scheduledPostId, content, accountId, status, scheduledAt, secondStageWanted",
      ExpressionAttributeNames: { "#st": "status", "#del": "isDeleted", "#sa": "scheduledAt" },
      Limit: limit,
    };

    const q = await ddb.send(new QueryCommand(params));
    const items = q.Items || [];
    const results = [];

    for (const it of items) {
      const scheduledPostId = (it.scheduledPostId?.S || it.SK?.S || "").replace(/^SCHEDULEDPOST#/, "");
      try {
        if (dryRun) {
          results.push({ scheduledPostId, simulated: true });
          continue;
        }

        // fetch account item
        const acct = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
        const accessToken = acct.Item?.accessToken?.S || "";
        const providerUserId = acct.Item?.providerUserId?.S || "";
        const secondStageContent = acct.Item?.secondStageContent?.S || "";
        const reservationSecondWanted = it.secondStageWanted?.BOOL;

        // Log retrieved data
        console.log('[DEBUG] scheduled item:', {
          scheduledPostId,
          accountId: it.accountId?.S || accountId,
          scheduledAt: it.scheduledAt?.N || it.scheduledAt,
          status: it.status?.S || null,
          secondStageWanted: it.secondStageWanted?.BOOL,
        });

        if (!accessToken) {
          const reason = 'missing accessToken';
          console.log(`[INFO] skip posting ${scheduledPostId}: ${reason}`);
          results.push({ scheduledPostId, ok: false, reason });
          continue;
        }

        const content = it.content?.S || "";
        if (!content || !String(content).trim()) {
          const reason = 'empty content';
          console.log(`[INFO] skip posting ${scheduledPostId}: ${reason}`);
          results.push({ scheduledPostId, ok: false, reason });
          continue;
        }

        // Perform actual Threads post (create + publish)
        try {
          const base = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';
          // Create
          const createBody = { media_type: 'TEXT', text: content, access_token: accessToken };
          const createRes = await fetch(`${base}/me/threads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createBody) });
          const createText = await createRes.text();
          if (!createRes.ok) throw new Error(`create_failed ${createRes.status} ${createText}`);
          const createJson = JSON.parse(createText || '{}');
          const creationId = createJson?.id;
          if (!creationId) throw new Error('creation_id missing');

          // Publish
          const publishEndpoint = providerUserId ? `${base}/${encodeURIComponent(providerUserId)}/threads_publish` : `${base}/me/threads_publish`;
          const publishBody = { creation_id: creationId, access_token: accessToken };
          const pubRes = await fetch(publishEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(publishBody) });
          const pubText = await pubRes.text();
          if (!pubRes.ok) throw new Error(`publish_failed ${pubRes.status} ${pubText}`);
          const pubJson = JSON.parse(pubText || '{}');
          const postId = pubJson?.id;
          if (!postId) throw new Error('postId missing after publish');

          // get permalink
          let permalink = null;
          try {
            const permRes = await fetch(`${base}/${encodeURIComponent(postId)}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`);
            if (permRes.ok) {
              const permJson = await permRes.json();
              if (permJson?.permalink) permalink = permJson.permalink;
            }
          } catch (e) {
            console.log('[WARN] permalink fetch failed', e?.message || e);
          }

          const nowTs = Math.floor(Date.now() / 1000);
          const names = { '#st': 'status' };
          const values = { ':posted': { S: 'posted' }, ':ts': { N: String(nowTs) }, ':pid': { S: postId }, ':f': { BOOL: false } };
          const sets = ['#st = :posted', 'postedAt = :ts', 'postId = :pid'];
          if (permalink) { values[':purl'] = { S: permalink }; sets.push('postUrl = :purl'); }
          if (secondStageContent && String(secondStageContent).trim() && reservationSecondWanted !== false) {
            values[':waiting'] = { S: 'waiting' };
            sets.push('doublePostStatus = :waiting');
          }

          await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));

          console.log(`[INFO] posted scheduledPostId=${scheduledPostId} postId=${postId} permalink=${permalink || ''}`);
          results.push({ scheduledPostId, ok: true, postId, permalink: permalink || null });
        } catch (e) {
          console.log(`[ERROR] posting failed for ${scheduledPostId}: ${String(e?.message || e)}`);
          results.push({ scheduledPostId, ok: false, error: String(e?.message || e) });
        }
      } catch (e) {
        results.push({ scheduledPostId, ok: false, error: String(e) });
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, count: items.length, results }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};


