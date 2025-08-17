// /src/lib/threads.ts

/**
 * Threads に本文テキストを実投稿します。
 * userId: SK のハンドル（ACCOUNT#xxxxx の xxxxx 部分）。未指定なら /me/threads を使用
 * accessToken: アカウントのアクセストークン
 * text: 投稿本文
 */
export async function postToThreads({
  userId,
  accessToken,
  text,
}: {
  userId?: string; // ← ハンドル（例: "remigiozarcorb618"）
  accessToken: string;
  text: string;
}): Promise<{ postId: string }> {
  const base =
    process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";

  // Next.js のサーバ環境が提供するグローバル fetch をそのまま使用
  const tryPost = async (path: string) => {
    const r = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, access_token: accessToken }),
    });
    if (!r.ok) {
      const tx = await r.text().catch(() => "");
      throw new Error(`${r.status} ${tx}`);
    }
    const j = (await r.json()) as { id?: string };
    if (!j?.id) throw new Error("no post id");
    return j.id as string;
  };

  let id: string;
  try {
    if (userId) {
      // 例: /{userId}/threads
      id = await tryPost(`${encodeURIComponent(userId)}/threads`);
    } else {
      // 例: /me/threads
      id = await tryPost(`me/threads`);
    }
  } catch {
    // フォールバック
    id = await tryPost(`me/threads`);
  }

  return { postId: id };
}
