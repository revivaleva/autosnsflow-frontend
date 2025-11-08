#!/usr/bin/env node
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import crypto from "crypto";

async function main() {
  const userId = process.argv[2] || process.env.USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
  const REGION = process.env.AWS_REGION || "ap-northeast-1";
  const TBL_X = process.env.TBL_X_ACCOUNTS || "XAccounts";
  const TBL_XS = process.env.TBL_X_SCHEDULED || "XScheduledPosts";
  const TBL_POOL = process.env.TBL_POST_POOL || "PostPool";

  const client = new DynamoDBClient({ region: REGION });
  const now = Math.floor(Date.now() / 1000);

  // create saikyou account
  const rawId = crypto.randomUUID();
  const accountId = `saikyou-${rawId.split("-")[0]}`;
  const accountName = "テスト最強アカウント";
  const accountItem = {
    PK: { S: `USER#${userId}` },
    SK: { S: `ACCOUNT#${accountId}` },
    accountId: { S: accountId },
    username: { S: accountName },
    createdAt: { N: String(now) },
    updatedAt: { N: String(now) },
    type: { S: "saikyou" },
    autoPostEnabled: { BOOL: true },
    authState: { S: "authorized" },
  };
  await client.send(new PutItemCommand({ TableName: TBL_X, Item: accountItem }));

  // posted scheduled post
  const postedId = crypto.randomUUID();
  const postedItem = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${postedId}` },
    scheduledPostId: { S: postedId },
    accountId: { S: accountId },
    accountName: { S: accountName },
    content: { S: "最強テスト：投稿済みの予約投稿" },
    scheduledAt: { N: String(now - 3600) },
    postedAt: { N: String(now - 1800) },
    status: { S: "posted" },
    postId: { S: `saikyou-post-${postedId.slice(0,8)}` },
    createdAt: { N: String(now) },
    updatedAt: { N: String(now) },
  };
  await client.send(new PutItemCommand({ TableName: TBL_XS, Item: postedItem }));

  // unposted empty content
  const unpostedId = crypto.randomUUID();
  const unpostedItem = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${unpostedId}` },
    scheduledPostId: { S: unpostedId },
    accountId: { S: accountId },
    accountName: { S: accountName },
    content: { S: "" },
    scheduledAt: { N: String(now + 3600) },
    postedAt: { N: "0" },
    status: { S: "scheduled" },
    createdAt: { N: String(now) },
    updatedAt: { N: String(now) },
  };
  await client.send(new PutItemCommand({ TableName: TBL_XS, Item: unpostedItem }));

  // 5 pool items type saikyou
  const poolIds = [];
  for (let i = 1; i <= 5; i++) {
    const pid = crypto.randomUUID();
    poolIds.push(pid);
    const pitem = {
      PK: { S: `USER#${userId}` },
      SK: { S: `POOL#${pid}` },
      poolId: { S: pid },
      type: { S: "saikyou" },
      content: { S: `最強プールのテスト投稿 ${i}` },
      images: { S: JSON.stringify([]) },
      createdAt: { N: String(now + i) },
    };
    await client.send(new PutItemCommand({ TableName: TBL_POOL, Item: pitem }));
  }

  console.log("Inserted saikyou X account:", accountId);
  console.log("Inserted XScheduledPosts posted:", postedId);
  console.log("Inserted XScheduledPosts unposted:", unpostedId);
  console.log("Inserted PostPool(saikyou) items:", poolIds);
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });


