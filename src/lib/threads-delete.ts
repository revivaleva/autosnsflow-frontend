import fetch from 'node-fetch';

export async function deleteThreadsPost({ postId, accountId }: { postId: string; accountId: string }) {
  // accountId は Threads アカウントIDではなく DB上の accountId。ここではアクセストークンを取得する
  // ただしフロント側APIからはアクセストークン取得が必要なので、実際の実装はサーバー側でaccountのaccessTokenを参照するAPI経由で行うべき
  // このヘルパーは単純に DELETE /{postId} を呼ぶ想定のスタブ実装
  const base = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';
  // NOTE: 実装上は accessToken が必要。ここではエラーを投げて呼び出し側が適切に実装するようにする
  throw new Error('deleteThreadsPost not implemented: server must use account access token to delete post');
}


