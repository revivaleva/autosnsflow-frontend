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

        // mark as posted (simulate real post) and set doublePostStatus if account has secondStageContent
        // fetch account item
        const acct = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } } }));
        const secondStageContent = acct.Item?.secondStageContent?.S || "";
        const reservationSecondWanted = it.secondStageWanted?.BOOL;

        const nowTs = Math.floor(Date.now() / 1000);
        const names = { "#st": "status" };
        const values = { ":posted": { S: "posted" }, ":ts": { N: String(nowTs) }, ":pid": { S: `lambda-test-${crypto.randomUUID()}` }, ":f": { BOOL: false } };
        const sets = ["#st = :posted", "postedAt = :ts", "postId = :pid"];

        if (secondStageContent && String(secondStageContent).trim() && reservationSecondWanted !== false) {
          values[":waiting"] = { S: "waiting" };
          sets.push("doublePostStatus = :waiting");
        }

        await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, UpdateExpression: `SET ${sets.join(", ")}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));

        results.push({ scheduledPostId, ok: true });
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


