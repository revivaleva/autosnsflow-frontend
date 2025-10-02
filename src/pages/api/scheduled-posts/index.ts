// src/pages/api/scheduled-posts/index.ts
// [MOD] 一覧( GET ) / 追加( POST ) / 更新・削除( PATCH ) を実装
//      一覧のレスポンスに postId / postUrl を含め、ビルドエラー(items 未定義)を解消

import type { NextApiRequest, NextApiResponse } from "next";
import {
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
  GetItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";
import crypto from "crypto";

const ddb = createDynamoClient();
const TBL_SCHEDULED = "ScheduledPosts";
const TBL_REPLIES = "Replies";
/* eslint-disable @typescript-eslint/no-explicit-any */
const TBL_LOGS = "ExecutionLogs";

// 任意の実行ログ出力（テーブル未作成時は黙ってスキップ）
async function putLog({
  userId = "unknown",
  type,
  accountId = "",
  targetId = "",
  status = "info",
  message = "",
  detail = {},
}: any) {
  // Follow same persistence policy as lambda putLog
  const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
  const shouldPersist = (status === 'error' && !!userId) || allowDebug;
  if (!shouldPersist) {
    try { console.log('[debug] putLog skipped persist', { userId, type, status, message }); } catch (_) {}
    return;
  }

  const item = {
    PK: { S: `USER#${userId}` },
    SK: { S: `LOG#${Date.now()}#${crypto.randomUUID()}` },
    type: { S: type || "system" },
    accountId: { S: accountId },
    targetId: { S: targetId },
    status: { S: status },
    message: { S: message },
    detail: { S: JSON.stringify(detail || {}) },
    createdAt: { N: String(Math.floor(Date.now() / 1000)) },
  };
  try {
    await ddb.send(new PutItemCommand({ TableName: TBL_LOGS, Item: item }));
  } catch (e) {
    console.log("[warn] putLog skipped:", String((e as Error)?.message || e));
  }
}

// リプライ状況を取得する関数（postIdとnumericPostIdの両方で検索）
async function getReplyStatusForPost(userId: string, postId: string | undefined, numericPostId?: string | undefined): Promise<{ replied: number; total: number }> {
  if (!postId && !numericPostId) return { replied: 0, total: 0 };
  
  try {
    const searchIds = [postId, numericPostId].filter(Boolean);
    console.log(`[DEBUG] リプライ状況検索開始 - 検索ID: [${searchIds.join(', ')}]`);
    
    const allItems: any[] = [];
    
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
    const replied = uniqueItems.filter((item: any) => item.status?.S === "replied").length;
    
    console.log(`[DEBUG] 最終リプライ状況: ${replied}/${total} (重複除去後)`);
    if (total > 0) {
      console.log(`[DEBUG] 見つかったリプライのpostId例:`, uniqueItems.slice(0, 3).map((i: any) => i.postId?.S));
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
    // 予約側に保存される二段階投稿希望フラグ
    secondStageWanted: getB("secondStageWanted"),
    // 削除予定時刻（秒）
    deleteScheduledAt: getN("deleteScheduledAt"),
    // 親投稿も削除するか
    deleteParentAfter: getB("deleteParentAfter"),
    // 削除済み時刻
    deletedAt: getN("deletedAt"),
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
        timeRange?: string;
      };

      const id = crypto.randomUUID();
      const scheduledAtSec =
        typeof body.scheduledAt === "number"
          ? body.scheduledAt
          : body.scheduledAt
          ? Math.floor(new Date(body.scheduledAt).getTime() / 1000)
          : 0;

      // Build item without undefined fields to satisfy TypeScript types for PutItemCommand
      const item: Record<string, any> = {
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
        timeRange: { S: body.timeRange ?? "" },
        // GSI 登録用マーカー: 未投稿かつ scheduled の場合に accountId を設定し、
        // PendingByAccTime GSI に載せる
        pendingForAutoPostAccount: { S: body.accountId ?? "" },
        // 二段階投稿希望フラグを保存（デフォルト false）
        secondStageWanted: { BOOL: !!(body as any).secondStageWanted },
        // スロット/予約単位で二段階削除を有効化するフラグ（日時は保存しない）
        deleteOnSecondStage: { BOOL: !!(body as any).deleteOnSecondStage },
        // 削除種別フラグ（デフォルト false）
        deleteParentAfter: { BOOL: !!(body as any).deleteParentAfter },
      };

      // no deleteScheduledAt: we store only boolean deleteOnSecondStage and compute timing at runtime

      // Put with a looser type to avoid TypeScript complaining about optional/undefined union
      await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item as any }));

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
        timeRange?: string;
        // 追加フィールド
        secondStageWanted?: boolean;
        // 新仕様: 日時ではなくフラグで管理する
        deleteOnSecondStage?: boolean;
        deleteParentAfter?: boolean;
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
        // 予約レコードを取得して状態確認
        const existing = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
        const status = existing.Item?.status?.S || "";
        // legacyPostId intentionally unused; kept for debugging context
        void existing.Item?.postId?.S;
        const accountId = existing.Item?.accountId?.S || "";

        // 未投稿 (status !== 'posted') の場合は物理削除
        if (status !== "posted") {
          await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
          res.status(200).json({ ok: true, deleted: true });
          return;
        }

        // 投稿済みの場合は Threads API を呼ばず、サーバ側では論理削除のみ行う
        // （実投稿の削除は行わない。フロントはデフォルトで論理削除済を非表示にしているため即時一覧から消える）
        const now = Math.floor(Date.now() / 1000);
        await ddb.send(
          new UpdateItemCommand({
            TableName: TBL_SCHEDULED,
            Key: key,
            UpdateExpression: "SET isDeleted = :t, deletedAt = :ts",
            ExpressionAttributeValues: { ":t": { BOOL: true }, ":ts": { N: String(now) } },
          })
        );
        res.status(200).json({ ok: true, deleted: false, deletedAt: now });
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

      // 追加: 二段階投稿/削除予定/親削除の PATCH 更新対応
      if (typeof body.secondStageWanted !== "undefined") {
        expr.push("secondStageWanted = :ssw");
        values[":ssw"] = { BOOL: !!body.secondStageWanted };
      }
      if (typeof body.deleteOnSecondStage !== "undefined") {
        expr.push("deleteOnSecondStage = :doss");
        values[":doss"] = { BOOL: !!body.deleteOnSecondStage };
      }
      if (typeof body.deleteParentAfter !== "undefined") {
        expr.push("deleteParentAfter = :dpa");
        values[":dpa"] = { BOOL: !!body.deleteParentAfter };
      }

      if (typeof body.timeRange === "string") {
        expr.push("timeRange = :tr");
        values[":tr"] = { S: body.timeRange };
      }

      if (expr.length === 0) {
        res.status(400).json({ error: "nothing_to_update" });
        return;
      }

      // Debug: log the update expression and values to help diagnose missing fields
      console.log(`[DEBUG] PATCH scheduled-posts update - key=${JSON.stringify(key)} expr=${JSON.stringify(
        expr
      )} names=${JSON.stringify(names)} values=${JSON.stringify(values)}`);

      await ddb.send(
        new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: key,
          UpdateExpression: `SET ${expr.join(", ")}`,
          ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
          ExpressionAttributeValues: values,
        })
      );

      // Return the updated item so clients can use authoritative data
      try {
        const updated = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: key }));
        return res.status(200).json({ ok: true, post: mapItem(updated.Item || {}) });
      } catch (e) {
        console.log('[WARN] failed to fetch updated item after patch:', String(e));
        return res.status(200).json({ ok: true });
      }
      return;
    }

    res.status(405).json({ error: "method_not_allowed" });
  } catch (e: any) {
    res
      .status(e?.statusCode || 500)
      .json({ error: e?.message || "internal_error" });
  }
}
