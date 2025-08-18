// /src/lib/threads.ts
// [MOD] getThreadsPermalink: fields=permalink を取得できたときのみ URL を返す
//      取得できない場合は null を返す（疑似ショートコード生成は廃止）

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

// [MOD] permalink のみを返す。取得できなければ null（DB保存もしない方針）
export async function getThreadsPermalink({
  accessToken,
  postId,
}: {
  accessToken: string;
  postId: string;
}): Promise<{ url: string; code: string } | null> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  try {
    const r = await fetch(
      `${base}/${encodeURIComponent(postId)}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`
    );
    const tx = await r.text();
    if (!r.ok) return null;
    const j = JSON.parse(tx) as { permalink?: string };
    if (!j?.permalink) return null;

    const m = j.permalink.match(/\/post\/([^/?#]+)/);
    const code = m?.[1] || "";
    if (!code) return null;

    // 必要ならドメインを強制（例: THREADS_PERMALINK_DOMAIN=www.threads.com）
    const prefer = process.env.THREADS_PERMALINK_DOMAIN;
    if (prefer) {
      try {
        const u = new URL(j.permalink);
        u.host = prefer;
        u.protocol = "https:";
        return { url: u.toString(), code };
      } catch {
        /* 失敗時は元URL */
      }
    }
    return { url: j.permalink, code };
  } catch {
    return null;
  }
}
