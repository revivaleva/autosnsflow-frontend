import type { NextApiRequest, NextApiResponse } from "next";
import { QueryCommand, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import { postToThreads, getThreadsPermalink } from "@/lib/threads";

const ddb = createDynamoClient();
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_THREADS = "ThreadsAccounts";

// Debug endpoint: run auto-post (immediate posting) for existing scheduled items of a given account
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const user = await verifyUserFromRequest(req);
    const userId = user.sub;
    const { accountId = "remigiozarcorb618", limit = 10 } = (req.body || {}) as any;

    // 1) find scheduled posts for this account that are not posted and not deleted and scheduledAt <= now
    const now = Math.floor(Date.now() / 1000);
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: "SCHEDULEDPOST#" },
        ":acc": { S: accountId },
        ":f": { BOOL: false },
        ":now": { N: String(now) },
      },
      FilterExpression: "accountId = :acc AND (attribute_not_exists(status) OR status = :sch) AND (attribute_not_exists(isDeleted) OR isDeleted = :f) AND scheduledAt <= :now",
      ProjectionExpression: "SK, scheduledPostId, content, accountId, status, scheduledAt",
      Limit: Number(limit || 10),
      ScanIndexForward: true,
    }));

    const items = (q.Items || []) as any[];
    const results: any[] = [];

    for (const it of items) {
      const scheduledPostId = (it.scheduledPostId?.S || it.SK?.S || "").replace(/^SCHEDULEDPOST#/, "");
      try {
        const content = it.content?.S || "";
        // get account credentials
        const acct = await ddb.send(new GetItemCommand({
          TableName: TBL_THREADS,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        }));

        const accessToken = acct.Item?.accessToken?.S || "";
        const providerUserId = acct.Item?.providerUserId?.S || "";

        if (!accessToken) {
          results.push({ scheduledPostId, ok: false, error: "missing accessToken" });
          continue;
        }

        // perform actual posting
        const { postId, numericId } = await postToThreads({
          accessToken,
          text: content,
          userIdOnPlatform: providerUserId,
        });

        const permalink = await getThreadsPermalink({ accessToken, postId }).catch(() => null);

        const nowTs = Math.floor(Date.now() / 1000);

        // update DB (similar to manual-post)
        const names: any = { "#st": "status" };
        const values: any = { ":posted": { S: "posted" }, ":ts": { N: String(nowTs) }, ":pid": { S: postId }, ":f": { BOOL: false } };
        const sets: string[] = ["#st = :posted", "postedAt = :ts", "postId = :pid"];
        if (numericId) { values[":nid"] = { S: numericId }; sets.push("numericPostId = :nid"); }
        if (permalink?.url) { values[":purl"] = { S: permalink.url }; sets.push("postUrl = :purl"); }

        // If account has secondStageContent and reservation flag allows, set waiting
        const secondStageContent = acct.Item?.secondStageContent?.S || "";
        const reservationSecondWanted = it.secondStageWanted?.BOOL;
        if (secondStageContent && String(secondStageContent).trim() && reservationSecondWanted !== false) {
          values[":waiting"] = { S: "waiting" };
          sets.push("doublePostStatus = :waiting");
        }

        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
          UpdateExpression: `SET ${sets.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }));

        results.push({ scheduledPostId, ok: true, postId, postUrl: permalink?.url || null });
      } catch (e: any) {
        results.push({ scheduledPostId, ok: false, error: String(e?.message || e) });
      }
    }

    return res.status(200).json({ ok: true, count: items.length, results });
  } catch (e: any) {
    console.error("run-auto-posts-remigio error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}


