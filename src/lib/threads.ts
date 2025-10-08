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
}): Promise<{ postId: string; numericId?: string }> {
  const base = process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0";
  const textPostAppId = process.env.THREADS_TEXT_APP_ID;
  // decide token priority globally for this call: prefer oauthAccessToken when available
  const primaryToken = oauthAccessToken && String(oauthAccessToken).trim() ? oauthAccessToken : (accessToken || '');

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

    // try primary token first (uses primaryToken from outer scope)
    body.access_token = primaryToken;
    let r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // helper: decide whether a 400 response indicates token/permission-like issue worth retrying with oauth token
    const shouldRetryOn400 = (txt: string) => {
      if (!txt) return false;
      const t = String(txt || '').toLowerCase();
      return t.includes('unsupported post request') || t.includes('missing permissions') || t.includes('does not support this operation') || t.includes('does not exist');
    };

    // If initial request failed, try the alternative token once (if available)
    if (!r.ok) {
      const alternativeToken = primaryToken === oauthAccessToken ? accessToken : oauthAccessToken;
      if (alternativeToken && alternativeToken !== primaryToken) {
          try {
          // info log removed
          body.access_token = alternativeToken;
          const r2 = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          r = r2;
        } catch (e) {
          // fall through to error handling
        }
      }
    }

    // If still not ok, consider retrying on some 400 responses that indicate permission/resource issues
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      if (r.status === 400 && shouldRetryOn400(errText)) {
        const alternativeToken = primaryToken === oauthAccessToken ? accessToken : oauthAccessToken;
        if (alternativeToken && alternativeToken !== primaryToken) {
          try {
            // info log removed
            body.access_token = alternativeToken;
            const r3 = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            r = r3;
          } catch (e) {
            // fall through
          }
        }
      }

      if (!r.ok) {
        const finalText = await r.text().catch(() => errText || "");
        throw new Error(`threads_create_failed: ${r.status} ${finalText}`);
      }
    }

    const tx = await r.text().catch(() => "");
    // Log entire me/threads create response for debugging (no webhook)
    try { /* debug removed */ } catch (_) {}
    if (!r.ok) {
      let parsedErr: any = {};
      try { parsedErr = JSON.parse(tx || '{}').error || {}; } catch (_) { parsedErr = {}; }
      if (parsedErr?.code === 190) {
        throw { type: 'auth_required', needsReauth: true, status: r.status, code: parsedErr.code, error_subcode: parsedErr.error_subcode || null, message: parsedErr.message || '', fbtrace_id: parsedErr.fbtrace_id || null };
      }
      throw new Error(`threads_create_failed: ${r.status} ${tx}`);
    }
    let j: any = {};
    try { j = JSON.parse(tx); } catch {}
    const creationId = j?.id;
    if (!creationId) throw new Error("threads_create_failed: creation_id missing");
    return creationId as string;
  };

  const publish = async (creationId: string) => {
    // Publish should call /me/threads_publish (or /{user}/threads_publish) with body { creation_id }
    const publishEndpoint = userIdOnPlatform
      ? `${base}/${encodeURIComponent(userIdOnPlatform)}/threads_publish`
      : `${base}/me/threads_publish`;

    if (!creationId) throw new Error('creation_id missing - cannot publish');

    // Debug logs
    try {
      // debug output removed
    } catch (_) {}

    // Verify token owner best-effort using primaryToken
    try {
      if (userIdOnPlatform && primaryToken) {
        const meResp = await fetch(`${base}/me?access_token=${encodeURIComponent(primaryToken)}`);
        if (meResp.ok) {
          const meJson = await meResp.json().catch(() => ({}));
          const meId = meJson?.id;
          if (meId && String(meId) !== String(userIdOnPlatform)) {
            throw new Error(`access token owner mismatch: tokenOwner=${meId} expected=${userIdOnPlatform}`);
          }
        }
      }
    } catch (e) {
      console.warn('[WARN] token owner check failed', e);
    }

    // Publish with retries for 5xx (exponential backoff up to 2 retries)
    const urlWithToken = `${publishEndpoint}?access_token=${encodeURIComponent(primaryToken)}`;
    const maxRetries = 2;
    let attempt = 0;
    let lastRespText = '';
    while (true) {
      attempt++;
      try {
        const resp = await fetch(urlWithToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: creationId }),
        });
        lastRespText = await resp.text().catch(() => '');

        // send debug to discord
        try { /* debug removed */ } catch (_) {}

        if (resp.ok) {
          let parsed: any = {};
          try { parsed = JSON.parse(lastRespText || '{}'); } catch {}
          const postId = parsed?.id || creationId;
          // debug output removed
          return postId as string;
        }

        // 4xx -> abort and log
        if (resp.status >= 400 && resp.status < 500) {
          try {
            const err = JSON.parse(lastRespText || '{}').error || {};
            const reason = String(err?.message || '').replace(/\s+/g, ' ').trim();
            const code = err?.code || '';
            const sub = err?.error_subcode || '';
            const fb = err?.fbtrace_id || '';
            console.warn(`[THREADS ERROR] publish failed status=${resp.status} code=${code} subcode=${sub} fbtrace_id=${fb} reason=${reason}`);
            if (err?.code === 190) {
              throw { type: 'auth_required', needsReauth: true, status: resp.status, code: err.code, error_subcode: err.error_subcode || null, message: err.message || reason, fbtrace_id: err.fbtrace_id || null };
            }
          } catch (e) {
            console.warn(`[THREADS ERROR] publish failed status=${resp.status} body=${String(lastRespText).slice(0,200)}`);
          }
          throw new Error(`Threads publish failed ${resp.status} ${String(lastRespText).slice(0,200)}`);
        }

        // 5xx retryable
        if (resp.status >= 500 && attempt <= maxRetries + 1) {
          const backoff = 200 * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        throw new Error(`Threads publish failed ${resp.status} ${String(lastRespText).slice(0,200)}`);
      } catch (e) {
        if (attempt > maxRetries) throw e;
        const backoff = 200 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    }
  };

  const creationId = await create();
  // debug output removed
  
  const postId = await publish(creationId);
  
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
  
  // 数字IDを取得（投稿詳細から）
  let numericId: string | undefined;
  try {
    const detailUrl = `${base}/${encodeURIComponent(postId)}?fields=id&access_token=${encodeURIComponent(accessToken)}`;
    const detailRes = await fetch(detailUrl);
    if (detailRes.ok) {
      const detailJson = await detailRes.json();
      numericId = detailJson?.id;
      // debug logging removed
    }
  } catch (e) {
    console.warn(`[WARN] 数字ID取得失敗: ${String(e).substring(0, 100)}`);
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
