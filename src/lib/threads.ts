// src/lib/threads.ts
// [MOD] Threads実投稿を「/me だけ」で実行（作成→公開の2段階）
//      media_type=TEXT を明示。必要なら THREADS_TEXT_APP_ID を送る。
//      どの段階で失敗したかが分かるようエラーメッセージを詳細化。

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
      media_type: "TEXT",       // [ADD] 必須パラメータ
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
    if (!r.ok) {
      throw new Error(`threads_create_failed: ${r.status} ${tx}`);
    }
    let j: any = {};
    try {
      j = JSON.parse(tx);
    } catch {
      /* noop */
    }
    const creationId = j?.id;
    if (!creationId) throw new Error("threads_create_failed: creation_id missing");
    return creationId as string;
  };

  const publish = async (creationId: string) => {
    const r = await fetch(`${base}/me/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: accessToken,
      }),
    });
    const tx = await r.text().catch(() => "");
    if (!r.ok) {
      throw new Error(`threads_publish_failed: ${r.status} ${tx}`);
    }
    let j: any = {};
    try {
      j = JSON.parse(tx);
    } catch {
      /* noop */
    }
    const postId = j?.id;
    if (!postId) throw new Error("threads_publish_failed: post id missing");
    return postId as string;
  };

  // [MOD] /me のみで実行（ユーザーID指定は使わない）
  const creationId = await create();
  const postId = await publish(creationId);
  return { postId };
}
