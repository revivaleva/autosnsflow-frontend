#!/usr/bin/env node
import { QueryCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "../src/lib/ddb";
import crypto from "crypto";

async function main() {
  const userId = process.argv[2] || process.env.USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
  const ddb = createDynamoClient();
  const TBL_X = process.env.TBL_X_ACCOUNTS || "XAccounts";
  const TBL_SCHEDULED = process.env.TBL_SCHEDULED || "ScheduledPosts";

  // find first X account for user
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_X,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
    ExpressionAttributeValues: {
      ":pk": { S: `USER#${userId}` },
      ":pfx": { S: "ACCOUNT#" },
    },
    Limit: 1,
  }));

  const first = (q.Items || [])[0];
  const accountId = first?.accountId?.S || (first?.SK?.S || "").replace(/^ACCOUNT#/, "") || "";
  const accountName = first?.username?.S || first?.displayName?.S || "";

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const scheduledAt = now + 3600; // 1 hour from now

  const item = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${id}` },
    scheduledPostId: { S: id },
    accountId: { S: accountId },
    accountName: { S: accountName },
    content: { S: "テスト用予約投稿（表示確認用）\n改行も含む" },
    scheduledAt: { N: String(scheduledAt) },
    postedAt: { N: "0" },
    status: { S: "scheduled" },
    isDeleted: { BOOL: false },
    createdAt: { N: String(now) },
    pendingForAutoPostAccount: { S: accountId },
  };

  await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));
  console.log("Inserted scheduled post:", { scheduledPostId: id, accountId, accountName, scheduledAt });
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});


