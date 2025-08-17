// /src/lib/threads.ts
// [MOD] postToThreads: /me で作成→公開（postId を取得）
// [MOD] getThreadsPermalink: 1) GraphAPIからpermalink取得 2) 失敗時はpostId→shortcode変換
// [MOD] BigIntリテラル未使用（ES2020未満でもOK）

export async function postToThreads({
  accessToken,
  text,
}: {
  accessToken: string;
  text: string;
}): Promise<{ postId: string }> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  const textPostAppId = process.env.THREADS_TEXT_APP_ID;

  const create = async () => {
    const body: Record<string, any> = {
      media_type: "TEXT",
      text,
      access_token: accessToken,
    };
    if (textPostAppId) body.text_post_app_id = textPostAppId;

    const r = await fetch(`${base}/me/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const tx = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`threads_create_failed: ${r.status} ${tx}`);
    let j: any = {};
    try { j = JSON.parse(tx); } catch {}
    const creationId = j?.id;
    if (!creationId) throw new Error("threads_create_failed: creation_id missing");
    return creationId as string;
  };

  const publish = async (creationId: string) => {
    const r = await fetch(`${base}/me/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
    });
    const tx = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`threads_publish_failed: ${r.status} ${tx}`);
    let j: any = {};
    try { j = JSON.parse(tx); } catch {}
    const postId = j?.id;
    if (!postId) throw new Error("threads_publish_failed: post id missing");
    return postId as string;
  };

  const creationId = await create();
  const postId = await publish(creationId);
  return { postId };
}

export async function getThreadsPermalink({
  accessToken,
  postId,
  handle, // 例: "remigiozarcorb618"
}: {
  accessToken: string;
  postId: string;
  handle: string;
}): Promise<{ url: string; code: string }> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";

  // 1) Graph API で permalink を取得
  try {
    const r = await fetch(
      `${base}/${encodeURIComponent(postId)}?fields=permalink_url&access_token=${encodeURIComponent(accessToken)}`
    );
    const tx = await r.text();
    if (r.ok) {
      const j = JSON.parse(tx) as { permalink_url?: string };
      if (j?.permalink_url) {
        const m = j.permalink_url.match(/\/post\/([^/?#]+)/);
        const code = m?.[1] || "";
        if (code) return { url: j.permalink_url, code };
      }
    }
  } catch { /* fallback */ }

  // 2) 失敗時: 数値 postId → shortcode 変換（Instagram/Threads 互換）
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let n: bigint;
  try { n = BigInt(postId); } catch {
    const url = `https://www.threads.com/@${encodeURIComponent(handle)}/post/${encodeURIComponent(postId)}`;
    return { url, code: postId };
  }
  const ZERO = BigInt(0);
  const SIXTY_FOUR = BigInt(64);
  let code = "";
  while (n > ZERO) {
    const rem = Number(n % SIXTY_FOUR);
    code = alphabet[rem] + code;
    n = n / SIXTY_FOUR;
  }
  if (!code) code = "0";

  const url = `https://www.threads.com/@${encodeURIComponent(handle)}/post/${encodeURIComponent(code)}`;
  return { url, code };
}
