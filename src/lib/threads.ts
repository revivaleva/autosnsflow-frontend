// src/lib/threads.ts
// [ADD] 公開URL(permalink)の取得。失敗時は postId→shortcode 変換で生成
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

  // 1) Graph API から permalink_url を取得（推奨）
  try {
    const r = await fetch(
      `${base}/${encodeURIComponent(postId)}?fields=permalink_url&access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    const tx = await r.text();
    if (r.ok) {
      const j = JSON.parse(tx) as { permalink_url?: string };
      if (j?.permalink_url) {
        // /@handle/post/<code> 形式なら最後のセグメントが shortcode
        const m = j.permalink_url.match(/\/post\/([^/?#]+)/);
        const code = m?.[1] || "";
        if (code) {
          return { url: j.permalink_url, code };
        }
      }
    }
  } catch {
    /* fallbackへ */
  }

  // 2) Fallback: 数値ID → shortcode へ変換（Instagram/Threads互換）
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let n = 0n;
  try {
    n = BigInt(postId);
  } catch {
    // 変換不可なら最終フォールバック：そのまま返す
    const url = `https://www.threads.com/@${encodeURIComponent(
      handle
    )}/post/${encodeURIComponent(postId)}`;
    return { url, code: postId };
  }
  let code = "";
  while (n > 0n) {
    const rem = Number(n % 64n);
    code = alphabet[rem] + code;
    n = n / 64n;
  }
  if (!code) code = "0"; // 念のため

  const url = `https://www.threads.com/@${encodeURIComponent(
    handle
  )}/post/${encodeURIComponent(code)}`;
  return { url, code };
}
