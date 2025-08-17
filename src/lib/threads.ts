// src/lib/threads.ts
// [MOD] 最小実装：userId(=ハンドル)が無い/使えない場合は /me/threads にフォールバック
import fetch from "node-fetch";

export async function postToThreads({
  userId,
  accessToken,
  text,
}: {
  userId?: string;             // ← SKのハンドル文字列（任意）
  accessToken: string;
  text: string;
}): Promise<{ postId: string }> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";

  // まずは user 指定のエンドポイントを試す（環境により不要なら /me を直接呼んでもOK）
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
  } catch (_) {
    // フォールバック
    id = await tryPost(`me/threads`);
  }
  return { postId: id };
}
