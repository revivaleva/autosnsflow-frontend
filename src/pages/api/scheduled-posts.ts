// /src/pages/api/scheduled-posts.ts

// [FIX] 予約投稿APIを新スキーマに合わせて全面整合
//       - レスポンスキーを posts に変更
//       - SK=SCHEDULEDPOST#... のアイテムをUI想定の型に整形
//       - POST/PATCH を新スキーマで受け付け（既存POST/PUT/DELETEは撤去）
//       - 認証は既存 verifyUserFromRequest を継続利用

import type { NextApiRequest, NextApiResponse } from "next";
import {
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL = process.env.TBL_SCHEDULED_POSTS || "ScheduledPosts";

// UIの想定型に整形するユーティリティ
function toUiPost(it: any) {
  return {
    // [FIX] scheduledPostId は属性 or SK から復元
    scheduledPostId:
      it?.scheduledPostId?.S ||
      String(it?.SK?.S || "").replace("SCHEDULEDPOST#", ""),
    accountName: it?.accountName?.S || "",
    accountId: it?.accountId?.S || "",
    scheduledAt: Number(it?.scheduledAt?.N || "0"),
    content: it?.content?.S || "",
    theme: it?.theme?.S || "",
    autoPostGroupId: it?.autoPostGroupId?.S || "",
    // [FIX] UIは "pending" / "posted" を使うため変換
    status: (it?.status?.S || "scheduled") === "posted" ? "posted" : "pending",
    postedAt: Number(it?.postedAt?.N || "0"),
    // [FIX] 投稿IDは postId をそのまま返す
    threadsPostId: it?.postId?.S || "",
    isDeleted: it?.isDeleted?.BOOL === true,
    // UIの「0/0」表示用に一応返す
    replyCount: Number(it?.replyCount?.N || "0"),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    // =======================
    // [FIX] GET: 一覧取得
    // =======================
    if (req.method === "GET") {
      const out = await ddb.send(
        new QueryCommand({
          TableName: TBL,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
          ExpressionAttributeValues: {
            ":pk": { S: `USER#${userId}` },
            ":pfx": { S: "SCHEDULEDPOST#" },
          },
          ScanIndexForward: true,
          Limit: 200,
        })
      );

      const posts = (out.Items || []).map(toUiPost).filter((p) => !p.isDeleted);
      // [FIX] フロントが期待するキー名で返す
      return res.status(200).json({ posts });
    }

    // =======================
    // [ADD] POST: 新規追加（新スキーマ）
    // =======================
    if (req.method === "POST") {
      // フロントの AddPostModal から来る値（最低限）
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const {
        scheduledPostId,
        accountName,
        accountId,
        scheduledAt,
        content,
        theme,
        autoPostGroupId,
      } = body || {};

      if (
        !scheduledPostId ||
        !accountId ||
        !accountName ||
        typeof scheduledAt === "undefined" ||
        scheduledAt === ""
      ) {
        return res
          .status(400)
          .json({ error: "scheduledPostId/accountId/accountName/scheduledAt required" });
      }

      const now = Math.floor(Date.now() / 1000);

      await ddb.send(
        new PutItemCommand({
          TableName: TBL,
          Item: {
            PK: { S: `USER#${userId}` },
            SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
            scheduledPostId: { S: String(scheduledPostId) },
            accountId: { S: String(accountId) },
            accountName: { S: String(accountName) },
            content: { S: String(content || "") },
            theme: { S: String(theme || "") },
            autoPostGroupId: { S: String(autoPostGroupId || "") },
            scheduledAt: { N: String(Number(scheduledAt)) },
            postedAt: { N: "0" },
            status: { S: "scheduled" },
            isDeleted: { BOOL: false },
            createdAt: { N: String(now) },
          },
          // [NOTE] 同一IDでの二重登録を避ける
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        })
      );

      return res.status(201).json({ ok: true });
    }

    // =======================
    // [ADD] PATCH: 論理削除や軽微更新
    // =======================
    if (req.method === "PATCH") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { scheduledPostId, isDeleted, content, scheduledAt, status } = body || {};
      if (!scheduledPostId) {
        return res.status(400).json({ error: "scheduledPostId required" });
      }

      const sets: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, any> = {};

      if (typeof isDeleted === "boolean") {
        sets.push("#d = :d");
        names["#d"] = "isDeleted";
        values[":d"] = { BOOL: isDeleted };
      }
      if (typeof content !== "undefined") {
        sets.push("#c = :c");
        names["#c"] = "content";
        values[":c"] = { S: String(content) };
      }
      if (typeof scheduledAt !== "undefined") {
        sets.push("#s = :s");
        names["#s"] = "scheduledAt";
        values[":s"] = { N: String(Number(scheduledAt)) };
      }
      if (typeof status !== "undefined") {
        sets.push("#st = :st");
        names["#st"] = "status";
        values[":st"] = { S: String(status) };
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: "no fields to update" });
      }

      await ddb.send(
        new UpdateItemCommand({
          TableName: TBL,
          Key: {
            PK: { S: `USER#${userId}` },
            SK: { S: `SCHEDULEDPOST#${scheduledPostId}` },
          },
          UpdateExpression: `SET ${sets.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      );

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PATCH"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    const code = e?.statusCode || (e?.message === "Unauthorized" ? 401 : 500);
    return res.status(code).json({ error: e?.message || "internal_error" });
  }
}
