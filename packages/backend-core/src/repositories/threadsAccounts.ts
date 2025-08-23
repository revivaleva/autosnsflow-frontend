// /packages/backend-core/src/repositories/threadsAccounts.ts
// [ADD] UIで使用する全属性を返す fetchThreadsAccountsFull を追加
//       既存の fetchThreadsAccounts は最小投影のまま「維持」

import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { ddb } from "../clients/ddb";
import { TBL_THREADS } from "../config";
import { pkUser } from "@autosnsflow/shared";

export type ThreadsAccount = {
  accountId: string;
  displayName: string;
};

// [KEEP] 既存：最小項目のみ（displayName）
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
          ":pfx": { S: "ACCOUNT#" },
        },
        ProjectionExpression: "SK, displayName",
        ...(LastEvaluatedKey ? { ExclusiveStartKey: LastEvaluatedKey } : {}),
      })
    );
    items = items.concat(res.Items || []);
    LastEvaluatedKey = res.LastEvaluatedKey;
  } while (LastEvaluatedKey);

  return items.map((i) => ({
    accountId: (i.SK?.S || "").replace("ACCOUNT#", ""),
    displayName: i.displayName?.S || "",
  }));
}

// [ADD] 追加：UIが利用している全属性（GETの応答に必要な一式）
export type ThreadsAccountFull = {
  accountId: string;
  username: string;
  displayName: string;
  accessToken: string;
  providerUserId: string; // [ADD] リプライ取得に必要

  autoPost: boolean;
  autoGenerate: boolean;
  autoReply: boolean;

  statusMessage: string;

  personaMode: string;
  personaSimple: string;
  personaDetail: string;

  autoPostGroupId: string;
  secondStageContent: string;

  createdAt: number;
  updatedAt: number;
};

export async function fetchThreadsAccountsFull(
  userId: string
): Promise<ThreadsAccountFull[]> {
  let items: any[] = [];
  let LastEvaluatedKey: any | undefined;

  // APIの現行GETで返しているフィールドに合わせて投影
  // （username, accessToken, auto* フラグ群、ペルソナ、グループ等）
  const ProjectionExpression = [
    "SK",
    "username",
    "displayName",
    "accessToken",
    "providerUserId", // [ADD] リプライ取得に必要
    "autoPost",
    "autoGenerate",
    "autoReply",
    "statusMessage",
    "personaMode",
    "personaSimple",
    "personaDetail",
    "autoPostGroupId",
    "secondStageContent",
    "createdAt",
    "updatedAt",
  ].join(", ");

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TBL_THREADS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: pkUser(userId) },
          ":pfx": { S: "ACCOUNT#" },
        },
        ProjectionExpression,
        ...(LastEvaluatedKey ? { ExclusiveStartKey: LastEvaluatedKey } : {}),
      })
    );
    items = items.concat(res.Items || []);
    LastEvaluatedKey = res.LastEvaluatedKey;
  } while (LastEvaluatedKey);

  return items.map((it) => ({
    accountId: (it?.SK?.S || "").replace("ACCOUNT#", ""),
    username: it?.username?.S || "",
    displayName: it?.displayName?.S || "",
    accessToken: it?.accessToken?.S || "",
    providerUserId: it?.providerUserId?.S || "", // [ADD] リプライ取得に必要

    autoPost: Boolean(it?.autoPost?.BOOL || false),
    autoGenerate: Boolean(it?.autoGenerate?.BOOL || false),
    autoReply: Boolean(it?.autoReply?.BOOL || false),

    statusMessage: it?.statusMessage?.S || "",

    personaMode: it?.personaMode?.S || "",
    personaSimple: it?.personaSimple?.S || "",
    personaDetail: it?.personaDetail?.S || "",

    autoPostGroupId: it?.autoPostGroupId?.S || "",
    secondStageContent: it?.secondStageContent?.S || "",

    createdAt: Number(it?.createdAt?.N || "0"),
    updatedAt: Number(it?.updatedAt?.N || "0"),
  }));
}
