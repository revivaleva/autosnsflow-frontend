// /src/pages/api/auto-post-groups.ts
// [MOD] decodeのみ→検証、Dynamo共通化、GETでbody読まない
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";             // [ADD]
import { verifyUserFromRequest } from "@/lib/auth";         // [ADD]

const ddb = createDynamoClient();                           // [ADD]
const TBL = process.env.TBL_AUTO_POST_GROUPS || "AutoPostGroups"; // [ADD]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);          // [ADD]
    const userId = user.sub;                                // [ADD]

    if (req.method === "GET") {
      const out = await ddb.send(new QueryCommand({
        TableName: TBL,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` } },
        ScanIndexForward: false,
        Limit: 200,
      }));
      const groups = (out.Items || []).map((i: any) => ({
        groupKey: i.SK?.S || "",
        groupName: i.groupName?.S || "",
        time1: i.time1?.S || "",
        theme1: i.theme1?.S || "",
        time2: i.time2?.S || "",
        theme2: i.theme2?.S || "",
        time3: i.time3?.S || "",
        theme3: i.theme3?.S || "",
        createdAt: i.createdAt?.N ? Number(i.createdAt.N) : undefined,
      }));
      return res.status(200).json({ groups });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { groupKey, groupName, time1, theme1, time2, theme2, time3, theme3, createdAt } = body || {};
      if (!groupKey || !groupName) return res.status(400).json({ error: "groupKey and groupName required" });

      const createdAtNumber = !createdAt || isNaN(Number(createdAt)) ? Math.floor(Date.now() / 1000) : Number(createdAt);
      await ddb.send(new PutItemCommand({
        TableName: TBL,
        Item: {
          PK: { S: `USER#${userId}` },
          SK: { S: String(groupKey) },
          groupName: { S: String(groupName) },
          time1: { S: time1 || "" }, theme1: { S: theme1 || "" },
          time2: { S: time2 || "" }, theme2: { S: theme2 || "" },
          time3: { S: time3 || "" }, theme3: { S: theme3 || "" },
          createdAt: { N: String(createdAtNumber) },
        },
      }));
      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { groupKey } = body || {};
      if (!groupKey) return res.status(400).json({ error: "groupKey required" });

      await ddb.send(new DeleteItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: String(groupKey) } },
      }));
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500); // [ADD]
    return res.status(code).json({ error: e?.message || String(e) });          // [MOD]
  }
}
