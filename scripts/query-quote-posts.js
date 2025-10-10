#!/usr/bin/env node
/**
 * Query ScheduledPosts for quote-type items for a given userId and print JSON.
 * Usage: node scripts/query-quote-posts.js <userId>
 */
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";

const userId = process.argv[2] || process.env.USER_ID;
if (!userId) {
  console.error("Usage: node scripts/query-quote-posts.js <userId>");
  process.exit(2);
}

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const TABLE = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";

const client = new DynamoDBClient({ region: REGION });

async function run() {
  try {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: `SCHEDULEDPOST#` },
      },
      Limit: 200,
      ReturnConsumedCapacity: "NONE",
    };

    const res = await client.send(new QueryCommand(params));
    const items = (res.Items || []).map((it) => ({
      SK: it.SK?.S,
      scheduledPostId: it.scheduledPostId?.S || (it.SK?.S || "").replace(/^SCHEDULEDPOST#/, ""),
      status: it.status?.S || "",
      type: it.type?.S || "",
      sourcePostId: it.sourcePostId?.S || "",
      postId: it.postId?.S || "",
      postUrl: it.postUrl?.S || "",
      content: it.content?.S || "",
      createdAt: it.createdAt?.N ? Number(it.createdAt.N) : undefined,
      scheduledAt: it.scheduledAt?.N ? Number(it.scheduledAt.N) : undefined,
      accountId: it.accountId?.S || "",
    }));

    const quotes = items.filter((x) => x.type === "quote");
    console.log(JSON.stringify({ userId, count: quotes.length, items: quotes }, null, 2));
  } catch (e) {
    console.error("Query failed:", String(e));
    process.exit(1);
  }
}

run();


