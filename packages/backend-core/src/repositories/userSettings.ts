// /packages/backend-core/src/repositories/userSettings.ts
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { ddb } from "../clients/ddb";
import { TBL_SETTINGS } from "../config";
import { pkUser, skSettings } from "@autosnsflow/shared";

export async function fetchDiscordWebhooks(userId: string): Promise<string[]> {
  const res = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: pkUser(userId) }, SK: { S: skSettings() } },
      ProjectionExpression: "discordWebhooks"
    })
  );

  const list = (res.Item?.discordWebhooks?.L || []).map((x) => x.S as string).filter(Boolean);
  if (!list.length) throw new Error(`Discord Webhook未設定: userId=${userId}`);
  return list;
}

export async function ensureUserSettingsExist(userId: string) {
  // Create a basic settings item if it does not exist
  try {
    await ddb.send(
      new (require("@aws-sdk/client-dynamodb").PutItemCommand)({
        TableName: TBL_SETTINGS,
        Item: {
          PK: { S: pkUser(userId) },
          SK: { S: skSettings() },
          createdAt: { N: String(Math.floor(Date.now() / 1000)) },
          updatedAt: { N: String(Math.floor(Date.now() / 1000)) },
          maxThreadsAccounts: { N: "0" },
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      })
    );
  } catch (e) {
    // ignore if exists or conditional failure
  }
}