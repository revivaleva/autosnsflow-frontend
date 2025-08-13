// /src/pages/api/scheduled-posts.ts
// [MOD] 認証→sub→Dynamo。GET時にreq.bodyを参照しない。
import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb"; // [ADD]
import { verifyUserFromRequest } from "@/lib/auth"; // [ADD]

const ddb = createDynamoClient();
const TBL = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";

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
        postId: it.postId?.S || "",
        platform: it.platform?.S || "",
        text: it.text?.S || "",
        mediaUrl: it.mediaUrl?.S || "",
        scheduledAt: it.scheduledAt?.S || "",
        status: it.status?.S || "scheduled",
        createdAt: Number(it.createdAt?.N || "0"),
        updatedAt: Number(it.updatedAt?.N || "0"),
      }));
      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const { postId, platform, text, mediaUrl, scheduledAt } = req.body || {};
      if (!postId || !platform || !text) return res.status(400).json({ error: "postId/platform/text required" });
      await ddb.send(new PutItemCommand({
        TableName: TBL,
        Item: {
          PK: { S: `USER#${userId}` }, SK: { S: `POST#${postId}` },
          postId: { S: postId },
          platform: { S: platform },
          text: { S: text },
          mediaUrl: { S: mediaUrl || "" },
          scheduledAt: { S: scheduledAt || "" },
          status: { S: "scheduled" },
          createdAt: { N: `${Math.floor(Date.now()/1000)}` },
          updatedAt: { N: `${Math.floor(Date.now()/1000)}` },
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }));
      return res.status(201).json({ ok: true });
    }

    if (req.method === "PUT") {
      const { postId, text, mediaUrl, scheduledAt, status } = req.body || {};
      if (!postId) return res.status(400).json({ error: "postId required" });
      await ddb.send(new UpdateItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `POST#${postId}` } },
        UpdateExpression: "SET text = :t, mediaUrl = :m, scheduledAt = :s, status = :st, updatedAt = :u",
        ExpressionAttributeValues: {
          ":t": { S: text || "" },
          ":m": { S: mediaUrl || "" },
          ":s": { S: scheduledAt || "" },
          ":st": { S: status || "scheduled" },
          ":u": { N: `${Math.floor(Date.now()/1000)}` },
        },
      }));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { postId } = req.query;
      if (!postId || typeof postId !== "string") return res.status(400).json({ error: "postId required" });
      await ddb.send(new DeleteItemCommand({
        TableName: TBL,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `POST#${postId}` } },
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
