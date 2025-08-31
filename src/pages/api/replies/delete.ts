import type { NextApiRequest, NextApiResponse } from "next";
import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb";
import { verifyUserFromRequest } from "@/lib/auth";

const ddb = createDynamoClient();
const TBL_REPLIES = process.env.TBL_REPLIES || "Replies";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    if (req.method !== "PATCH") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { replyId } = req.body || {};
    if (!replyId) return res.status(400).json({ error: "replyId is required" });

    // replyId が "REPLY#..." の形式で渡される可能性があるため正規化
    const normalized = String(replyId).startsWith("REPLY#") ? String(replyId).slice(6) : String(replyId);

    const key = { PK: { S: `USER#${userId}` }, SK: { S: `REPLY#${normalized}` } };

    // 存在確認
    const existing = await ddb.send(new GetItemCommand({ TableName: TBL_REPLIES, Key: key }));
    if (!existing.Item) return res.status(404).json({ error: "Reply not found" });

    // ステータス確認 -> 未返信なら物理削除、返信済みなら API 側の実投稿削除と論理削除に変更
    const status = existing.Item?.status?.S || "";
    if (status !== "replied") {
      // 未返信: 物理削除
      await ddb.send(new (require('@aws-sdk/client-dynamodb').DeleteItemCommand)({ TableName: TBL_REPLIES, Key: key }));
      return res.status(200).json({ ok: true, deleted: true });
    }

    // 返信済み: 実投稿（Threads）を削除する必要がある。
    try {
      // postId と accountId を確認
      const postId = existing.Item?.responsePostId?.S || existing.Item?.postId?.S;
      const accountId = existing.Item?.accountId?.S;
      if (!postId || !accountId) {
        // 情報不足 -> DB は論理削除にしておく
        const now = Math.floor(Date.now() / 1000);
        await ddb.send(new UpdateItemCommand({ TableName: TBL_REPLIES, Key: key, UpdateExpression: 'SET isDeleted = :d, deletedAt = :ts', ExpressionAttributeValues: { ':d': { BOOL: true }, ':ts': { N: String(now) } } }));
        return res.status(200).json({ ok: true, deleted: false, reason: 'missing_post_or_account' });
      }

      // Threads 側削除を試みる（lib/threads-delete を利用）
      const { deleteThreadsPost } = await Promise.resolve(require('@/lib/threads-delete'));
      await deleteThreadsPost({ postId, accountId, userId });

      // 削除成功 -> 論理削除フラグを立てる
      const now2 = Math.floor(Date.now() / 1000);
      await ddb.send(new UpdateItemCommand({ TableName: TBL_REPLIES, Key: key, UpdateExpression: 'SET isDeleted = :d, deletedAt = :ts', ExpressionAttributeValues: { ':d': { BOOL: true }, ':ts': { N: String(now2) } } }));
      return res.status(200).json({ ok: true, deleted: false });
    } catch (e: any) {
      console.error('replies/delete threads delete error:', e);
      // 削除失敗はログ化した上で論理削除に切り替える
      const now3 = Math.floor(Date.now() / 1000);
      await ddb.send(new UpdateItemCommand({ TableName: TBL_REPLIES, Key: key, UpdateExpression: 'SET isDeleted = :d, deletedAt = :ts, deleteAttemptFailed = :t', ExpressionAttributeValues: { ':d': { BOOL: true }, ':ts': { N: String(now3) }, ':t': { BOOL: true } } }));
      return res.status(200).json({ ok: false, error: 'threads_delete_failed' });
    }

  } catch (e: any) {
    console.error("replies/delete error:", e);
    return res.status(500).json({ error: "Internal Server Error", message: e?.message || "Unknown" });
  }
}


