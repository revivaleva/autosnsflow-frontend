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
    // inspectOnly: when true, only list all posts for the account and log eligibility for each
    // default true for safety: run real posting only if inspectOnly=false and dryRun=false
    const inspectOnly = typeof event.inspectOnly !== "undefined" ? !!event.inspectOnly : true;

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

    // For inspection we retrieve all scheduled posts for the account (paginate)
    const queryBase = {
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: "SCHEDULEDPOST#" } },
      ProjectionExpression: "SK, scheduledPostId, content, accountId, status, scheduledAt, secondStageWanted, isDeleted",
      ExpressionAttributeNames: { "#st": "status", "#del": "isDeleted", "#sa": "scheduledAt" },
      Limit: 100,
    };

    // paginate to collect up to `limit` items (if limit present)
    let items = [];
    let lastKey = undefined;
    while (items.length < limit) {
      const qp = { ...queryBase };
      if (lastKey) qp.ExclusiveStartKey = lastKey;
      const resp = await ddb.send(new QueryCommand(qp));
      const page = resp.Items || [];
      items = items.concat(page);
      if (!resp.LastEvaluatedKey) break;
      lastKey = resp.LastEvaluatedKey;
    }
    const results = [];

    const inspectResults = [];
    for (const it of items) {
      const scheduledPostId = (it.scheduledPostId?.S || it.SK?.S || "").replace(/^SCHEDULEDPOST#/, "");
      try {
        // For inspection mode: determine eligibility and log reason
        const isDeleted = it.isDeleted?.BOOL === true;
        const status = it.status?.S || "";
        const scheduledAt = it.scheduledAt?.N ? Number(it.scheduledAt.N) : (it.scheduledAt?.S ? Number(it.scheduledAt.S) : 0);
        const content = it.content?.S || "";

        const reasons = [];
        if (isDeleted) reasons.push("isDeleted");
        if (status === "posted") reasons.push("already_posted");
        if (!content || !String(content).trim()) reasons.push("empty_content");
        if (scheduledAt && scheduledAt > now) reasons.push("scheduled_in_future");

        // fetch account item to check tokens
        const acct = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
        const accessToken = acct.Item?.accessToken?.S || "";
        if (!accessToken) reasons.push("missing_access_token");

        const eligible = reasons.length === 0;
        console.log(`[ELIGIBILITY] scheduledPostId=${scheduledPostId} eligible=${eligible} reasons=${reasons.join(',')}`);
        inspectResults.push({ scheduledPostId, eligible, reasons });

        if (inspectOnly) continue; // do not perform posting in inspect mode

        // If not inspectOnly, continue to posting logic (unchanged)
        if (dryRun) {
          results.push({ scheduledPostId, simulated: true });
          continue;
        }

        const access = acct.Item?.accessToken?.S || "";
        const providerUserId = acct.Item?.providerUserId?.S || "";
        const secondStageContent = acct.Item?.secondStageContent?.S || "";
        const reservationSecondWanted = it.secondStageWanted?.BOOL;

        if (!access) {
          const reason = 'missing accessToken';
          console.log(`[INFO] skip posting ${scheduledPostId}: ${reason}`);
          results.push({ scheduledPostId, ok: false, reason });
          continue;
        }

        if (!content || !String(content).trim()) {
          const reason = 'empty content';
          console.log(`[INFO] skip posting ${scheduledPostId}: ${reason}`);
          results.push({ scheduledPostId, ok: false, reason });
          continue;
        }

        // (posting logic continues as before)
      } catch (e) {
        console.log(`[ERROR] iterate item error for ${scheduledPostId}: ${String(e)}`);
        results.push({ scheduledPostId, ok: false, error: String(e) });
      }
    }

    // return both inspection and any posting results
    return { statusCode: 200, body: JSON.stringify({ ok: true, count: items.length, inspect: inspectResults, results }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};


