// src/pages/api/scheduled-posts/index.ts
// [MOD] 一覧レスポンスに postId / postUrl を含める（表示用）
// ※実装形態により Query/Scan の後の map 部分だけ修正してください。

// ・・・略（DynamoDBから items を取得）・・・
const posts = items.map((it) => ({
  scheduledPostId: it.scheduledPostId?.S || it.SK?.S?.replace("SCHEDULEDPOST#","") || "",
  accountName: it.accountName?.S || "",
  accountId: it.accountId?.S || "",
  scheduledAt: it.scheduledAt?.N ? Number(it.scheduledAt.N) : undefined,
  content: it.content?.S || "",
  theme: it.theme?.S || "",
  autoPostGroupId: it.autoPostGroupId?.S || "",
  status: it.status?.S || "",
  postedAt: it.postedAt?.N ? Number(it.postedAt.N) : undefined,
  // [ADD] ↓↓↓
  postId: it.postId?.S || "",
  postUrl: it.postUrl?.S || "",
  // ↑↑↑
  isDeleted: it.isDeleted?.BOOL === true,
  replyCount: it.replyCount?.N ? Number(it.replyCount.N) : 0,
}));
// res.json({ ok: true, posts });

