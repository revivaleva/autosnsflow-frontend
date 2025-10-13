// /src/lib/threads.ts
// [MOD] getThreadsPermalink: fields=permalink を取得できたときのみ URL を返す
//      取得できない場合は null を返す（疑似ショートコード生成は廃止）

export async function postToThreads({
  accessToken,
  oauthAccessToken,
  text,
  userIdOnPlatform,
  inReplyTo,
}: {
  accessToken: string;
  oauthAccessToken?: string;
  text: string;
  userIdOnPlatform?: string;
  inReplyTo?: string;
}): Promise<{ postId: string; numericId?: string; creationId?: string; publishedNumeric?: string }> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  const textPostAppId = process.env.THREADS_TEXT_APP_ID;
  // Use oauthAccessToken only (no accessToken fallback)
  const primaryToken = oauthAccessToken && String(oauthAccessToken).trim() ? oauthAccessToken : '';

  const create = async () => {
    const body: Record<string, any> = {
      media_type: "TEXT",
      text,
    };
    if (textPostAppId) body.text_post_app_id = textPostAppId;
    
    // リプライパラメータ（公式ドキュメント準拠）
    // https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies
    if (inReplyTo) {
      // ドキュメント準拠: reply_to_id を使用
      // https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies
      body.reply_to_id = inReplyTo;
      // debug output removed
    } else {
      // debug output removed
    }

    // 🔧 公式ドキュメント準拠: Create は常に /me/threads を使用
    // https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies
    const endpoint = `${base}/me/threads`;

    // debug output removed

    if (!primaryToken) throw { type: 'auth_required', needsReauth: true, message: 'oauthAccessToken required for create' };
    const url = `${endpoint}?access_token=${encodeURIComponent(primaryToken)}`;
    let r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const tx = await r.text().catch(() => "");
    if (!r.ok) {
      let parsedErr: any = {};
      try { parsedErr = JSON.parse(tx || '{}').error || {}; } catch (_) { parsedErr = {}; }
      if (parsedErr?.code === 190) {
        throw { type: 'auth_required', needsReauth: true, status: r.status, code: parsedErr.code, message: parsedErr.message || '', fbtrace_id: parsedErr.fbtrace_id || null };
      }
      throw new Error(`threads_create_failed: ${r.status} ${tx}`);
    }
    let j: any = {};
    try { j = JSON.parse(tx); } catch {}
    const creationId = j?.id;
    if (!creationId) throw new Error("threads_create_failed: creation_id missing");
    // log create response for observability
    try { console.info('[THREADS CREATE]', { creationId, status: r.status, raw: tx.slice(0,800) }); } catch (_) {}
    return creationId as string;
  };

    const publish = async (creationId: string) => {
    // Always publish via /me/threads_publish to ensure create/publish user context matches token owner
    const publishEndpoint = `${base}/me/threads_publish`;
    if (!creationId) throw new Error('creation_id missing');
    if (!primaryToken) throw { type: 'auth_required', needsReauth: true, message: 'oauthAccessToken required for publish' };
    const urlWithToken = `${publishEndpoint}?access_token=${encodeURIComponent(primaryToken)}`;
    const resp = await fetch(urlWithToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: creationId }) });
    const txt = await resp.text().catch(() => '');
    if (!resp.ok) throw new Error(`threads_quote_publish_failed: ${resp.status} ${txt}`);
    let parsed: any = {};
    try { parsed = JSON.parse(txt); } catch {}
    const postId = parsed?.id || creationId;
    const publishedNumeric = parsed?.id || undefined;
    // log publish response and parsed payload for debugging
    try { console.info('[THREADS PUBLISH]', { postId, status: resp.status, raw: txt.slice(0,800) }); } catch (_) {}
    try { console.info('[DBG threads] publish parsed', { parsed, publishedNumeric, raw: txt.slice(0,2000) }); } catch (_) {}
    return { postId: postId as string, publishedNumeric };
  };

  const creationId = await create();
  // debug output removed
  
  const publishResp = await publish(creationId);
  let postId = publishResp.postId;
  const publishedNumericId = publishResp.publishedNumeric;
  try { console.info('[DBG threads] publishResp', publishResp, 'publishedNumericId', publishedNumericId); } catch (_) {}

  // Try to prefer the permalink code (string) for display: if the published post has a permalink
  // we extract its code and use that as the canonical postId returned to callers. This ensures
  // UI displays the string code rather than a numeric ID when available.
  try {
    const perm = await getThreadsPermalink({ accessToken: primaryToken, postId });
    if (perm && perm.code) {
      postId = perm.code;
    }
  } catch (e) {
    // ignore and keep existing postId
  }

  // inReplyTo がある場合はリプライとして作成されたかを検証。通常投稿なら削除してエラーを投げる。
  if (inReplyTo) {
    try {
      const verifyUrl = `${base}/${encodeURIComponent(postId)}?fields=id,reply_to_id,parent_id&access_token=${encodeURIComponent(accessToken)}`;
      const v = await fetch(verifyUrl);
      const tx = await v.text().catch(() => "");
      let j: any = {}; try { j = JSON.parse(tx); } catch {}
      const ok = !!(j?.reply_to_id === inReplyTo || j?.parent_id === inReplyTo);
      if (!ok) {
        await fetch(`${base}/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(accessToken)}`, { method: 'DELETE' }).catch(() => {});
        throw new Error(`threads_reply_validation_failed: created normal post (postId=${postId})`);
      }
    } catch (e) {
      console.warn(`[WARN] reply validation failed: ${String(e).slice(0, 160)}`);
    }
  }
  // debug output removed
  
  // 数字IDを取得（publish のレスポンスに含まれる id を優先）
  let numericId: string | undefined = publishedNumericId || undefined;
  if (!numericId) {
    try {
      const tokenForDetail = primaryToken || accessToken || '';
      if (tokenForDetail) {
        const detailUrl = `${base}/${encodeURIComponent(postId)}?fields=id&access_token=${encodeURIComponent(tokenForDetail)}`;
        // retry a few times because numeric id may not be immediately available
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const detailRes = await fetch(detailUrl);
            const txt = await detailRes.text().catch(() => '');
            if (!detailRes.ok) {
              if (attempt < 2) await new Promise(r => setTimeout(r, 800));
              continue;
            }
            let detailJson: any = {};
            try { detailJson = JSON.parse(txt || '{}'); } catch (_) { detailJson = {}; }
            if (detailJson?.id) {
              numericId = detailJson.id;
              break;
            }
            if (attempt < 2) await new Promise(r => setTimeout(r, 800));
          } catch (innerErr) {
            if (attempt < 2) await new Promise(r => setTimeout(r, 800));
            continue;
          }
        }
      }
    } catch (e) {
      console.warn(`[WARN] 数字ID取得失敗: ${String(e).substring(0, 100)}`);
    }
  }

  // FALLBACK: if numericId still missing, attempt to search the account's recent posts
  // and match by text (best-effort). This helps when numeric id is not exposed via detail
  // endpoint due to timing or API behavior. Use accessToken (not oauth) to list user's media.
  if (!numericId) {
    try {
      const listToken = accessToken || primaryToken || '';
      if (listToken) {
        // search recent posts of the account (me/media) and try to match by text substring
        // we will request recent items and compare their text to the original text
        const listUrl = `${base}/me/media?fields=id,caption&access_token=${encodeURIComponent(listToken)}`;
        const listRes = await fetch(listUrl);
        if (listRes.ok) {
          const listJson = await listRes.json().catch(() => ({}));
          const data = listJson?.data || [];
          for (const it of data) {
            const candidateId = it?.id;
            if (!candidateId) continue;
            try {
              const detailUrl2 = `${base}/${encodeURIComponent(candidateId)}?fields=id,caption&access_token=${encodeURIComponent(listToken)}`;
              const dr = await fetch(detailUrl2);
              if (!dr.ok) continue;
              const dj = await dr.json().catch(() => ({}));
              const caption = dj?.caption || '';
              // simple substring match against posted text (text variable may be long)
              if (text && caption && caption.includes(String(text).substring(0, Math.min(200, String(text).length)))) {
                numericId = dj?.id;
                break;
              }
            } catch (_) { continue; }
          }
        }
      }
    } catch (e) {
      console.warn('[WARN] numericId fallback search failed:', String(e).substring(0,200));
    }
  }
  
  return { postId, numericId, creationId, publishedNumeric: publishedNumericId };
}

export async function postQuoteToThreads({
  accessToken,
  oauthAccessToken,
  text,
  referencedPostId,
  userIdOnPlatform,
}: {
  accessToken: string;
  oauthAccessToken?: string;
  text: string;
  referencedPostId: string;
  userIdOnPlatform?: string;
}): Promise<{ postId: string; numericId?: string; creationId?: string; publishedNumeric?: string }> {
  if (!referencedPostId) throw new Error('referencedPostId required');
  // reuse create/publish flow but include referenced_posts in creation body
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  // Use oauthAccessToken only; no fallback to accessToken
  const primaryToken = oauthAccessToken && String(oauthAccessToken).trim() ? oauthAccessToken : '';

  const create = async () => {
    if (!primaryToken) throw { type: 'auth_required', needsReauth: true, message: 'oauthAccessToken required for quote create' };
    // Per Threads behaviour, referenced_posts must be sent as a JSON string in form-encoded or multipart body.
    // Use application/x-www-form-urlencoded and put referenced_posts as JSON string.
    const endpoint = `${base}/me/threads`;
    // Include quote_post_id in query string as some API behaviors expect the referenced post id
    // to be present in the request URL. Keep access_token in query string for consistency.
    const url = `${endpoint}?access_token=${encodeURIComponent(primaryToken)}&quote_post_id=${encodeURIComponent(referencedPostId)}`;
    const form = new URLSearchParams();
    form.append('media_type', 'TEXT');
    form.append('text', text);
    if (process.env.THREADS_TEXT_APP_ID) form.append('text_post_app_id', process.env.THREADS_TEXT_APP_ID);
    // Log sanitized request (no tokens)
    try {
      const sanitizedBody = { media_type: 'TEXT', text: String(text).slice(0,2000) };
      console.info('[THREADS QUOTE CREATE REQ]', { endpoint: url.replace(primaryToken, '***'), body: sanitizedBody });
      try {
        (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
        (global as any).__TEST_OUTPUT__.push({ tag: 'THREADS_QUOTE_CREATE_REQ', endpoint: String(url).replace(primaryToken, '***'), body: sanitizedBody });
      } catch (_) {}
    } catch (_) {}
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const tx = await r.text().catch(() => '');
    // Log response
    try { console.info('[THREADS QUOTE CREATE RESP]', { status: r.status, raw: tx.slice(0,2000) }); } catch (_) {}
    try {
      (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
      (global as any).__TEST_OUTPUT__.push({ tag: 'THREADS_QUOTE_CREATE_RESP', status: r.status, raw: String(tx).slice(0,2000) });
    } catch (_) {}
    if (!r.ok) throw new Error(`threads_quote_create_failed: ${r.status} ${tx}`);
    let j: any = {};
    try { j = JSON.parse(tx); } catch {}
    const creationId = j?.id;
    if (!creationId) throw new Error('threads_quote_create_failed: creation_id missing');
    try { console.info('[THREADS QUOTE CREATE]', { creationId, status: r.status }); } catch (_) {}
    return creationId as string;
  };

  const publish = async (creationId: string) => {
    if (!primaryToken) throw { type: 'auth_required', needsReauth: true, message: 'oauthAccessToken required for publish' };
    const publishEndpoint = userIdOnPlatform
      ? `${base}/${encodeURIComponent(userIdOnPlatform)}/threads_publish`
      : `${base}/me/threads_publish`;
    if (!creationId) throw new Error('creation_id missing');
    // Send creation_id as query parameter (no JSON body) to match API expectations
    const urlWithToken = `${publishEndpoint}?access_token=${encodeURIComponent(primaryToken)}&creation_id=${encodeURIComponent(creationId)}`;
    // Log publish request (no body)
    try { console.info('[THREADS QUOTE PUBLISH REQ]', { endpoint: urlWithToken.replace(primaryToken, '***') }); } catch (_) {}
    try {
      (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
      (global as any).__TEST_OUTPUT__.push({ tag: 'THREADS_QUOTE_PUBLISH_REQ', endpoint: String(urlWithToken).replace(primaryToken, '***') });
    } catch (_) {}
    const resp = await fetch(urlWithToken, { method: 'POST' });
    const txt = await resp.text().catch(() => '');
    try { console.info('[THREADS QUOTE PUBLISH RESP]', { status: resp.status, raw: txt.slice(0,2000) }); } catch (_) {}
    try {
      (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
      (global as any).__TEST_OUTPUT__.push({ tag: 'THREADS_QUOTE_PUBLISH_RESP', status: resp.status, raw: String(txt).slice(0,2000) });
    } catch (_) {}
    if (!resp.ok) throw new Error(`threads_quote_publish_failed: ${resp.status} ${txt}`);
    let parsed: any = {};
    try { parsed = JSON.parse(txt); } catch {}
    const postId = parsed?.id || creationId;
    return postId as string;
  };

  const creationId = await create();
  let postId = await publish(creationId);

  // try to get permalink like postToThreads
  try {
    const perm = await getThreadsPermalink({ accessToken: primaryToken, postId }).catch(() => null);
    if (perm && perm.code) postId = perm.code;
  } catch {}

  // numeric id retrieval
  let numericId: string | undefined;
  try {
    const detailUrl = `${base}/${encodeURIComponent(postId)}?fields=id&access_token=${encodeURIComponent(primaryToken)}`;
    const detailRes = await fetch(detailUrl);
    if (detailRes.ok) {
      const detailJson = await detailRes.json();
      numericId = detailJson?.id;
    }
  } catch {}

  return { postId, numericId, creationId, publishedNumeric };
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
