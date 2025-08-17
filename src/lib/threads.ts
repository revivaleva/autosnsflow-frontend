// src/lib/threads.ts
// [MOD] Threads投稿を「作成 -> 公開」の2段階で実施。media_type=TEXT 付与。
//      ユーザーID（ハンドル=SKの後半）指定と /me フォールバックを実装。

/**
 * Threads に本文テキストを実投稿します（作成 -> 公開）。
 * userId: SKのハンドル（ACCOUNT#xxxxx の xxxxx 部分）。未指定なら /me を使用
 * accessToken: アカウントのアクセストークン
 * text: 投稿本文
 * 戻り: 公開後の postId
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
  const textPostAppId = process.env.THREADS_TEXT_APP_ID; // 必要な環境のみ設定

  // 作成（creation_id を取得）
  const create = async (path: string) => {
    const body: Record<string, any> = {
      media_type: "TEXT",
      text,
      access_token: accessToken,
    };
    if (textPostAppId) body.text_post_app_id = textPostAppId;

    const r = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const tx = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`create ${r.status} ${tx}`);
    const j = JSON.parse(tx) as { id?: string };
    if (!j?.id) throw new Error("creation_id missing");
    return j.id;
  };

  // 公開（postId を取得）
  const publish = async (path: string, creationId: string) => {
    const r = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: accessToken,
      }),
    });
    const tx = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`publish ${r.status} ${tx}`);
    const j = JSON.parse(tx) as { id?: string };
    if (!j?.id) throw new Error("post id missing on publish");
    return j.id;
  };

  // userId があれば /{userId}/threads(_publish)、なければ /me/... を使用
  const createPath = userId
    ? `${encodeURIComponent(userId)}/threads`
    : `me/threads`;
  const publishPath = userId
    ? `${encodeURIComponent(userId)}/threads_publish`
    : `me/threads_publish`;

  let creationId: string;
  try {
    creationId = await create(createPath);
  } catch {
    // フォールバック
    creationId = await create("me/threads");
  }

  let postId: string;
  try {
    postId = await publish(publishPath, creationId);
  } catch {
    // フォールバック
    postId = await publish("me/threads_publish", creationId);
  }

  return { postId };
}
