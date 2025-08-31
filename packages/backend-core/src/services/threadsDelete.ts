// /packages/backend-core/src/services/threadsDelete.ts
// Threads投稿の削除を行い、HTTPステータスとレスポンスの要約を返すユーティリティ
export async function deleteThreadPost({ postId, accessToken }: { postId: string; accessToken: string; }) {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  if (!postId) return { ok: false, status: 0, body: "no_post_id" };
  try {
    const url = `${base}/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, { method: "DELETE" });
    const text = await res.text().catch(() => "");
    const snippet = (text || "").slice(0, 1000);
    if (!res.ok) {
      return { ok: false, status: res.status, body: snippet };
    }
    return { ok: true, status: res.status, body: snippet };
  } catch (e: any) {
    return { ok: false, status: 0, body: String(e?.message || e) };
  }
}


