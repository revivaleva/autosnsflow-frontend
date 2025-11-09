#!/usr/bin/env node
/**
 * Delete all X scheduled posts for accounts classified as 'general' for a given user.
 *
 * Usage:
 *   node scripts/delete-general-pool-x-scheduled-posts.js <userId> [--yes] [--dry-run]
 *
 * Notes:
 * - Requires AWS credentials (env or shared config).
 * - This will delete items from the table configured by env TBL_X_SCHEDULED (fallback: XScheduledPosts).
 * - By default the script asks for confirmation. Use --yes to skip confirmation.
 */
import readline from "readline";
import { DynamoDBClient, QueryCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";

const USER_ID = process.argv[2] || process.env.USER_ID;
const SKIP_CONFIRM = process.argv.includes("--yes");
const DRY_RUN = process.argv.includes("--dry-run");

if (!USER_ID) {
  console.error("Usage: node scripts/delete-general-pool-x-scheduled-posts.js <userId> [--yes] [--dry-run]");
  process.exit(2);
}

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const TBL_X_ACCOUNTS = process.env.TBL_X_ACCOUNTS || "XAccounts";
const TBL_X_SCHEDULED = process.env.TBL_X_SCHEDULED || "XScheduledPosts";

const client = new DynamoDBClient({ region: REGION });

async function promptYesNo(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + " (y/N) ", (answer) => {
      rl.close();
      const ok = String(answer || "").trim().toLowerCase() === "y";
      resolve(ok);
    });
  });
}

async function run() {
  try {
    console.log(`userId=${USER_ID} region=${REGION} table_accounts=${TBL_X_ACCOUNTS} table_scheduled=${TBL_X_SCHEDULED}`);

    // 1) Fetch accounts for user and collect accountIds where type is 'general' or missing
    const qAcc = await client.send(new QueryCommand({
      TableName: TBL_X_ACCOUNTS,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${USER_ID}` },
        ":pfx": { S: "ACCOUNT#" },
      },
      Limit: 1000,
    }));
    const itemsAcc = (qAcc.Items || []);
    const generalAccountIds = itemsAcc
      .map(it => (it.accountId?.S || (it.SK?.S || "").replace(/^ACCOUNT#/, "")))
      .filter((_, idx) => {
        const it = itemsAcc[idx];
        const t = (it.type && it.type.S) ? String(it.type.S) : "general";
        return t === "general";
      });

    console.log(`Found ${generalAccountIds.length} general account(s).`);
    if (generalAccountIds.length === 0) {
      console.log("No accounts to target. Exiting.");
      return;
    }

    // 2) Query scheduled posts for user
    const qSched = await client.send(new QueryCommand({
      TableName: TBL_X_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${USER_ID}` },
        ":pfx": { S: "SCHEDULEDPOST#" },
      },
      Limit: 1000,
    }));
    const itemsSched = (qSched.Items || []);
    const toDelete = itemsSched.filter(it => {
      const acc = it.accountId?.S || "";
      return generalAccountIds.includes(acc);
    }).map(it => ({ PK: it.PK, SK: it.SK, scheduledPostId: it.scheduledPostId?.S || (it.SK?.S || "").replace(/^SCHEDULEDPOST#/, "") }));

    console.log(`Found ${toDelete.length} scheduled post(s) for general accounts.`);
    if (toDelete.length === 0) return;

    if (DRY_RUN) {
      console.log("Dry run mode; would delete the following scheduledPostIds:");
      console.log(JSON.stringify(toDelete.map(x => x.scheduledPostId), null, 2));
      return;
    }

    if (!SKIP_CONFIRM) {
      const ok = await promptYesNo("Proceed to delete these scheduled posts?");
      if (!ok) {
        console.log("Aborted by user.");
        return;
      }
    }

    // 3) Delete items one by one
    for (const it of toDelete) {
      try {
        await client.send(new DeleteItemCommand({
          TableName: TBL_X_SCHEDULED,
          Key: {
            PK: it.PK,
            SK: it.SK,
          },
        }));
        console.log(`Deleted scheduledPostId=${it.scheduledPostId}`);
      } catch (e) {
        console.error(`Failed to delete ${it.scheduledPostId}:`, String(e));
      }
    }

    console.log("Done.");
  } catch (e) {
    console.error("Error:", String(e));
    process.exit(1);
  }
}

run();


