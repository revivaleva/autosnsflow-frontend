// src/lib/threads.ts
// [MOD] node-fetch 依存なし。Threads への実投稿で media_type=TEXT を付与
//      環境変数 THREADS_TEXT_APP_ID があれば text_post_app_id も送信

/**
 * Threads に本文テキストを実投稿します。
 * userId: SKのハンドル（ACCOUNT#xxxxx の xxxxx 部分）。未指定なら /me/threads を使用
 * accessToken: アカウントのアクセストークン
 * text: 投稿本文
 */
export async function postToThreads({
  userId,
  accessToken,
  text,
}: {
  userId?: string;   // 例: "remigiozarcorb618"
  accessToken: string;
  text: string;
}): Promise<{ postId: string }> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  const textPostAppId = process.env.THREADS_TEXT_APP_ID; // ← 任意。必要な環境のみ設定

  // Next.js サーバーのグローバル fetch を使用
  const tryPost = async (path: string) => {
    const body: Record<string, any> = {
      media_type: "TEXT",        // [ADD] これが必須
      text,
      access_token: accessToken,
    };
    if (textPostAppId) body.text_post_app_id = textPostAppId; // 任意

    const r = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      // エラー内容をそのまま返す（デバッグしやすくする）
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
