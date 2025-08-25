// /src/lib/threads.ts
// [MOD] getThreadsPermalink: fields=permalink を取得できたときのみ URL を返す
//      取得できない場合は null を返す（疑似ショートコード生成は廃止）

export async function postToThreads({
  accessToken,
  text,
  userIdOnPlatform,
  inReplyTo,
}: {
  accessToken: string;
  text: string;
  userIdOnPlatform?: string;
  inReplyTo?: string;
}): Promise<{ postId: string; numericId?: string }> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  const textPostAppId = process.env.THREADS_TEXT_APP_ID;

  const create = async () => {
    const body: Record<string, any> = {
      media_type: "TEXT",
      text,
      access_token: accessToken,
    };
    if (textPostAppId) body.text_post_app_id = textPostAppId;
    
    // リプライパラメータ（公式ドキュメント準拠）
    // https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies
    if (inReplyTo) {
      body.reply_to_id = inReplyTo;  // 🔧 公式準拠: replied_to_id → reply_to_id
      console.log(`[DEBUG] リプライとして投稿: inReplyTo=${inReplyTo}`);
    } else {
      console.log(`[DEBUG] 通常投稿: inReplyToなし`);
    }

    // 🔧 公式ドキュメント準拠: Create は常に /me/threads を使用
    // https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies
    const endpoint = `${base}/me/threads`;

    console.log(`[DEBUG] 投稿エンドポイント: ${endpoint}`);
    console.log(`[DEBUG] 投稿ペイロード: ${JSON.stringify({...body, access_token: "***"}, null, 2)}`);
    console.log(`[DEBUG] userIdOnPlatform: ${userIdOnPlatform}`);
    console.log(`[DEBUG] inReplyTo: ${inReplyTo}`);
    console.log(`[DEBUG] リプライモード: ${inReplyTo ? 'YES' : 'NO'}`);

    let r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    // リプライ失敗時のリトライ（代替パラメータで再試行）
    if (!r.ok && inReplyTo) {
      const errText = await r.text().catch(() => "");
      console.log(`[WARN] リプライ投稿失敗、代替パラメータでリトライ: ${r.status} ${errText}`);
      
      // reply_to_id を replied_to_id に変更してリトライ（フォールバック）
      const retryBody = { ...body };
      delete retryBody.reply_to_id;
      retryBody.replied_to_id = inReplyTo;
      
      console.log(`[DEBUG] リトライペイロード: ${JSON.stringify({...retryBody, access_token: "***"}, null, 2)}`);
      
      r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryBody),
      });
      
      if (!r.ok) {
        const err2 = await r.text().catch(() => "");
        console.error(`[ERROR] リトライも失敗: first=${errText} / retry=${err2}`);
      } else {
        console.log(`[INFO] リトライ成功 (replied_to_id)`);
      }
    }
    
    const tx = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`threads_create_failed: ${r.status} ${tx}`);
    let j: any = {};
    try { j = JSON.parse(tx); } catch {}
    const creationId = j?.id;
    if (!creationId) throw new Error("threads_create_failed: creation_id missing");
    return creationId as string;
  };

  const publish = async (creationId: string) => {
    // 🔧 公式ドキュメント準拠: Publish は /{threads-user-id}/threads_publish を使用
    // https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies  
    const publishEndpoint = userIdOnPlatform 
      ? `${base}/${encodeURIComponent(userIdOnPlatform)}/threads_publish`
      : `${base}/me/threads_publish`;  // フォールバック（公式仕様では threads-user-id が必須）
    
    console.log(`[DEBUG] 公開エンドポイント: ${publishEndpoint}`);
    console.log(`[DEBUG] 公開creationId: ${creationId}`);
    
    const r = await fetch(publishEndpoint, {
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
  console.log(`[DEBUG] 作成完了 creationId: ${creationId}`);
  
  const postId = await publish(creationId);
  console.log(`[DEBUG] 公開完了 postId: ${postId}`);
  
  // 数字IDを取得（投稿詳細から）
  let numericId: string | undefined;
  try {
    const detailUrl = `${base}/${encodeURIComponent(postId)}?fields=id&access_token=${encodeURIComponent(accessToken)}`;
    const detailRes = await fetch(detailUrl);
    if (detailRes.ok) {
      const detailJson = await detailRes.json();
      numericId = detailJson?.id;
      console.log(`[INFO] 投稿完了: ${postId} (numeric: ${numericId})`);
    }
  } catch (e) {
    console.log(`[WARN] 数字ID取得失敗: ${String(e).substring(0, 100)}`);
  }
  
  return { postId, numericId };
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
