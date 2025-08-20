// /packages/backend-core/src/repositories/threadsAccounts.ts
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { ddb } from "../clients/ddb";
import { TBL_THREADS } from "../config";
import { pkUser, skAccount } from "@autosnsflow/shared";

export type ThreadsAccount = { accountId: string; displayName: string };

export async function fetchThreadsAccounts(userId: string): Promise<ThreadsAccount[]> {
  let items: any[] = [];
  let LastEvaluatedKey: any | undefined;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TBL_THREADS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: pkUser(userId) },
          ":pfx": { S: "ACCOUNT#" }
        },
        ProjectionExpression: "SK, displayName",
        ...(LastEvaluatedKey ? { ExclusiveStartKey: LastEvaluatedKey } : {})
      })
    );
    items = items.concat(res.Items || []);
    LastEvaluatedKey = res.LastEvaluatedKey;
  } while (LastEvaluatedKey);

  return items.map((i) => ({
    accountId: (i.SK?.S || "").replace("ACCOUNT#", ""),
    displayName: i.displayName?.S || ""
  }));
}
