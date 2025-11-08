#!/usr/bin/env node
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import crypto from "crypto";

async function main() {
  const userId = process.argv[2] || process.env.USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
  const REGION = process.env.AWS_REGION || "ap-northeast-1";
  const TBL_X = process.env.TBL_X_ACCOUNTS || "XAccounts";

  const client = new DynamoDBClient({ region: REGION });

  const rawId = crypto.randomUUID();
  const shortId = rawId.split("-")[0];
  const accountId = `testx-${shortId}`;
  const username = "テストXアカウント";
  const now = Math.floor(Date.now() / 1000);

  const item = {
    PK: { S: `USER#${userId}` },
    SK: { S: `ACCOUNT#${accountId}` },
    accountId: { S: accountId },
    providerUserId: { S: accountId },
    username: { S: username },
    clientId: { S: "" },
    clientSecret: { S: "" },
    accessToken: { S: "" },
    oauthAccessToken: { S: "" },
    autoPostEnabled: { BOOL: true },
    authState: { S: "authorized" },
    createdAt: { N: String(now) },
    updatedAt: { N: String(now) },
    type: { S: "general" },
    failureCount: { N: "0" },
  };

  await client.send(new PutItemCommand({ TableName: TBL_X, Item: item }));
  console.log("Inserted X account:", { accountId, username, userId });
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });


