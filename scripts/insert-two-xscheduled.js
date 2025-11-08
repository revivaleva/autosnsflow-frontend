#!/usr/bin/env node
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import crypto from "crypto";

async function main() {
  const userId = process.argv[2] || process.env.USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
  const REGION = process.env.AWS_REGION || "ap-northeast-1";
  const TBL = process.env.TBL_X_SCHEDULED || "XScheduledPosts";

  const client = new DynamoDBClient({ region: REGION });
  const now = Math.floor(Date.now() / 1000);

  const idPosted = crypto.randomUUID();
  const postedItem = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${idPosted}` },
    scheduledPostId: { S: idPosted },
    accountId: { S: "testx-ad1a6a90" },
    accountName: { S: "テストXアカウント" },
    content: { S: "X用テスト：投稿済みの予約投稿" },
    scheduledAt: { N: String(now - 3600) },
    postedAt: { N: String(now - 1800) },
    status: { S: "posted" },
    postId: { S: "x-posted-TEST-123" },
    createdAt: { N: String(now) },
    updatedAt: { N: String(now) },
  };

  const idUnposted = crypto.randomUUID();
  const unpostedItem = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${idUnposted}` },
    scheduledPostId: { S: idUnposted },
    accountId: { S: "testx-ad1a6a90" },
    accountName: { S: "テストXアカウント" },
    content: { S: "" },
    scheduledAt: { N: String(now + 3600) },
    postedAt: { N: "0" },
    status: { S: "scheduled" },
    createdAt: { N: String(now) },
    updatedAt: { N: String(now) },
  };

  await client.send(new PutItemCommand({ TableName: TBL, Item: postedItem }));
  await client.send(new PutItemCommand({ TableName: TBL, Item: unpostedItem }));

  console.log("Inserted X scheduled-post (posted):", idPosted);
  console.log("Inserted X scheduled-post (unposted empty):", idUnposted);
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });


