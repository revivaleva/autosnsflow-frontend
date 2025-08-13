// /src/pages/api/threads-accounts.ts
// [MOD] GETでreq.bodyを触らない/認証→sub→Dynamo参照へ統一
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb"; // [ADD]
import { verifyUserFromRequest } from "@/lib/auth"; // [ADD]

const ddb = createDynamoClient();
const TBL = process.env.TBL_THREADS_ACCOUNTS || "ThreadsAccounts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req); // [ADD]
    const userId = user.sub;                        // [ADD]

    if (req.method === "GET") {
      const out = await ddb.send(new QueryCommand({
        TableName: TBL,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` } },
        ScanIndexForward: true,
        Limit: 200,
      }));
      const items = (out.Items || []).map((it: any) => ({
        accountId: it.accountId?.S || "",
        username: it.username?.S || "",
        displayName: it.displayName?.S || "",
        createdAt: Number(it.createdAt?.N || "0"),
        updatedAt: Number(it.updatedAt?.N || "0"),
      }));
      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const { accountId, username, displayName } = req.body || {};
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      await ddb.send(new PutItemCommand({
        TableName: TBL,
        Item: {
          PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` },
          accountId: { S: accountId },
          username: { S: username || "" },
          displayName: { S: displayName || "" },
          createdAt: { N: `${Math.floor(Date.now()/1000)}` },
          updatedAt: { N: `${Math.floor(Date.now()/1000)}` },
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }));
      return res.status(201).json({ ok: true });
    }

    if (req.method === "PUT") {
      const { accountId, username, displayName } = req.body || {};
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      await ddb.send(new UpdateItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        UpdateExpression: "SET username = :u, displayName = :d, updatedAt = :ts",
        ExpressionAttributeValues: {
          ":u": { S: username || "" },
          ":d": { S: displayName || "" },
          ":ts": { N: `${Math.floor(Date.now()/1000)}` },
        },
      }));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { accountId } = req.query;
      if (!accountId || typeof accountId !== "string") return res.status(400).json({ error: "accountId required" });
      await ddb.send(new DeleteItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
      }));
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
