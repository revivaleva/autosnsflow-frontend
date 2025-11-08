#!/usr/bin/env node
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import crypto from "crypto";

async function main() {
  const userId = process.argv[2] || process.env.USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
  const REGION = process.env.AWS_REGION || "ap-northeast-1";
  const TBL_SCHEDULED = process.env.TBL_SCHEDULED || "ScheduledPosts";

  const client = new DynamoDBClient({ region: REGION });

  const now = Math.floor(Date.now() / 1000);

  // 1) Posted record
  const postedId = crypto.randomUUID();
  const postedItem = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${postedId}` },
    scheduledPostId: { S: postedId },
    accountId: { S: "testx-ad1a6a90" },
    accountName: { S: "テストXアカウント" },
    content: { S: "テスト：投稿済の予約投稿（表示用）" },
    scheduledAt: { N: String(now - 3600) }, // in the past
    postedAt: { N: String(now - 1800) },
    status: { S: "posted" },
    postId: { S: "posted-TEST-12345" },
    postUrl: { S: "https://www.threads.net/post/posted-TEST-12345" },
    isDeleted: { BOOL: false },
    createdAt: { N: String(now) },
    pendingForAutoPostAccount: { S: "testx-ad1a6a90" },
  };

  // 2) Unposted record with empty content
  const scheduledId = crypto.randomUUID();
  const scheduledItem = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${scheduledId}` },
    scheduledPostId: { S: scheduledId },
    accountId: { S: "testx-ad1a6a90" },
    accountName: { S: "テストXアカウント" },
    content: { S: "" },
    scheduledAt: { N: String(now + 3600) }, // 1 hour from now
    postedAt: { N: "0" },
    status: { S: "scheduled" },
    isDeleted: { BOOL: false },
    createdAt: { N: String(now) },
    pendingForAutoPostAccount: { S: "testx-ad1a6a90" },
  };

  await client.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: postedItem }));
  await client.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: scheduledItem }));

  console.log("Inserted posted scheduled-post:", postedId);
  console.log("Inserted unposted (empty content) scheduled-post:", scheduledId);
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });


