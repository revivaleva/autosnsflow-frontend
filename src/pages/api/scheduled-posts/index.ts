// src/pages/api/scheduled-posts/index.ts
// [MOD] 一覧( GET ) / 追加( POST ) / 更新・削除( PATCH ) を実装
//      一覧のレスポンスに postId / postUrl を含め、ビルドエラー(items 未定義)を解消

import type { NextApiRequest, NextApiResponse } from "next";
import {
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import crypto from "crypto";

const ddb = createDynamoClient();
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_REPLIES = "Replies";

// リプライ状況を取得する関数（postIdとnumericPostIdの両方で検索）
async function getReplyStatusForPost(userId: string, postId: string | undefined, numericPostId?: string | undefined): Promise<{ replied: number; total: number }> {
  if (!postId && !numericPostId) return { replied: 0, total: 0 };
  
  try {
    const searchIds = [postId, numericPostId].filter(Boolean);
    console.log(`[DEBUG] リプライ状況検索開始 - 検索ID: [${searchIds.join(', ')}]`);
    
    let allItems: any[] = [];
    
    // 複数のpostIDで検索
    for (const searchId of searchIds) {
      if (!searchId) continue;
      
      const result = await ddb.send(new QueryCommand({
        TableName: TBL_REPLIES,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        FilterExpression: "postId = :postId",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "REPLY#" },
          ":postId": { S: searchId },
        },
        ProjectionExpression: "#st, postId, SK",
        ExpressionAttributeNames: { "#st": "status" },
      }));
      
      if (result.Items) {
        console.log(`[DEBUG] postId "${searchId}" で ${result.Items.length} 件のリプライを発見`);
        allItems.push(...result.Items);
      }
    }
    
    // 重複を除去（同じSKは1つだけ）
    const uniqueItems = allItems.reduce((acc, item) => {
      const sk = item.SK?.S;
      if (sk && !acc.some((existing: any) => existing.SK?.S === sk)) {
        acc.push(item);
      }
      return acc;
    }, [] as any[]);
    
    const total = uniqueItems.length;
    const replied = uniqueItems.filter(item => item.status?.S === "replied").length;
    
    console.log(`[DEBUG] 最終リプライ状況: ${replied}/${total} (重複除去後)`);
    if (total > 0) {
      console.log(`[DEBUG] 見つかったリプライのpostId例:`, uniqueItems.slice(0, 3).map(i => i.postId?.S));
    }
    
    return { replied, total };
  } catch (e) {
    console.error(`Error getting reply status for posts [${postId}, ${numericPostId}]:`, e);
    return { replied: 0, total: 0 };
  }
}

// DynamoDB アイテムをフロント用の形へ
function mapItem(it: any) {
  const getS = (k: string) => it?.[k]?.S ?? "";
  const getN = (k: string) =>
    typeof it?.[k]?.N === "string" ? Number(it[k].N) : undefined;
  const getB = (k: string) => it?.[k]?.BOOL === true;

  // scheduledPostId は保存されていない場合があるので SK から復元
  let scheduledPostId = getS("scheduledPostId");
  if (!scheduledPostId) {
    const sk = it?.SK?.S ?? "";
    if (sk.startsWith("SCHEDULEDPOST#")) {
      scheduledPostId = sk.replace("SCHEDULEDPOST#", "");
    }
  }

  return {
    scheduledPostId,
    accountName: getS("accountName"),
    accountId: getS("accountId"),
    scheduledAt: getN("scheduledAt"),
    content: getS("content"),
    theme: getS("theme"),
    autoPostGroupId: getS("autoPostGroupId"),
    status: getS("status"),
    postedAt: getN("postedAt"),
    // [ADD] 一覧にも返す
    postId: getS("postId"),
    numericPostId: getS("numericPostId"), // 数字の投稿ID
    postUrl: getS("postUrl"),
    isDeleted: getB("isDeleted"),
    replyCount: getN("replyCount") ?? 0,
    // 二段階投稿関連
    doublePostStatus: getS("doublePostStatus"),
    secondStagePostId: getS("secondStagePostId"),
    secondStageAt: getN("secondStageAt"),
    timeRange: getS("timeRange"),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await verifyUserFromRequest(req).catch(() => null);
  if (!user?.sub) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const userId = user.sub;

  try {
    if (req.method === "GET") {
      // ============ 一覧 ============
      const out = await ddb.send(
        new QueryCommand({
          TableName: TBL_SCHEDULED,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
          ExpressionAttributeValues: {
            ":pk": { S: `USER#${userId}` },
            ":pfx": { S: "SCHEDULEDPOST#" },
          },
        })
      );
      const items = out.Items ?? [];
      const posts = items.map(mapItem).filter((x) => !x.isDeleted);
      
      // リプライ状況を並行して取得
      const postsWithReplies = await Promise.all(
        posts.map(async (post) => {
          if (post.status === "posted" && (post.postId || post.numericPostId)) {
            // postIdとnumericPostIdの両方を使ってリプライ状況を取得
            const replyStatus = await getReplyStatusForPost(userId, post.postId, post.numericPostId);
            return {
              ...post,
              replyStatus: {
                replied: replyStatus.replied,
                total: replyStatus.total,
              }
            };
          }
          return {
            ...post,
            replyStatus: { replied: 0, total: 0 }
          };
        })
      );
      
      res.status(200).json({ ok: true, posts: postsWithReplies });
      return;
    }

    if (req.method === "POST") {
      // ============ 追加 ============
      const body = (req.body || {}) as {
        accountId?: string;
        accountName?: string;
        scheduledAt?: number | string;
        content?: string;
        theme?: string;
        autoPostGroupId?: string;
      };

      const id = crypto.randomUUID();
      const scheduledAtSec =
        typeof body.scheduledAt === "number"
          ? body.scheduledAt
          : body.scheduledAt
          ? Math.floor(new Date(body.scheduledAt).getTime() / 1000)
          : 0;

      const item = {
        PK: { S: `USER#${userId}` },
        SK: { S: `SCHEDULEDPOST#${id}` },
        scheduledPostId: { S: id },
        accountId: { S: body.accountId ?? "" },
        accountName: { S: body.accountName ?? "" },
        autoPostGroupId: { S: body.autoPostGroupId ?? "" },
        theme: { S: body.theme ?? "" },
        content: { S: body.content ?? "" },
        scheduledAt: { N: String(scheduledAtSec) },
        postedAt: { N: "0" },
        status: { S: "scheduled" },
        isDeleted: { BOOL: false },
        createdAt: { N: String(Math.floor(Date.now() / 1000)) },
      };

      await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));

      res.status(200).json({
        ok: true,
        post: mapItem(item),
      });
      return;
    }

    if (req.method === "PATCH") {
      // ============ 更新 / 削除 ============
      const body = (req.body || {}) as {
        scheduledPostId: string;
        isDeleted?: boolean;
        content?: string;
        scheduledAt?: number | string;
      };
      if (!body.scheduledPostId) {
        res.status(400).json({ error: "missing_scheduledPostId" });
        return;
      }

      const key = {
        PK: { S: `USER#${userId}` },
        SK: { S: `SCHEDULEDPOST#${body.scheduledPostId}` },
      };

      // 削除フラグ
      if (body.isDeleted === true) {
        await ddb.send(
          new UpdateItemCommand({
            TableName: TBL_SCHEDULED,
            Key: key,
            UpdateExpression: "SET isDeleted = :t",
            ExpressionAttributeValues: { ":t": { BOOL: true } },
          })
        );
        res.status(200).json({ ok: true });
        return;
      }

      // 内容/日時の編集
      const expr: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, any> = {};

      if (typeof body.content === "string") {
        expr.push("#content = :content");
        names["#content"] = "content";
        values[":content"] = { S: body.content };
      }

      if (typeof body.scheduledAt !== "undefined") {
        const sec =
          typeof body.scheduledAt === "number"
            ? body.scheduledAt
            : Math.floor(new Date(body.scheduledAt).getTime() / 1000);
        expr.push("scheduledAt = :sa");
        values[":sa"] = { N: String(sec) };
      }

      if (expr.length === 0) {
        res.status(400).json({ error: "nothing_to_update" });
        return;
      }

      await ddb.send(
        new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: key,
          UpdateExpression: `SET ${expr.join(", ")}`,
          ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
          ExpressionAttributeValues: values,
        })
      );

      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "method_not_allowed" });
  } catch (e: any) {
    res
      .status(e?.statusCode || 500)
      .json({ error: e?.message || "internal_error" });
  }
}
