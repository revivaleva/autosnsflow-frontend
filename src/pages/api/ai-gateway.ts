// /src/pages/api/ai-gateway.ts
// [MOD] personaMode による厳密な使い分け。互換の input.persona は削除。
import type { NextApiRequest, NextApiResponse } from 'next';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import jwt from 'jsonwebtoken';

const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

function getCookie(req: NextApiRequest, name: string): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const items = cookie.split(";").map(s => s.trim());
  for (const kv of items) {
    const [k, ...rest] = kv.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function extractUserId(req: NextApiRequest): string | null {
  const rawAuth = (req.headers.authorization || (req.headers as any).Authorization) as string | undefined;
  if (rawAuth && rawAuth.startsWith('Bearer ')) {
    const token = rawAuth.slice('Bearer '.length);
    try {
      const payload: any = jwt.decode(token);
      const uid = payload?.userId || payload?.sub || payload?.['custom:userid'];
      if (uid) return String(uid);
    } catch {}
  }
  try {
    const idToken = getCookie(req, "idToken");
    if (idToken) {
      const payload: any = jwt.decode(idToken);
      const uid = payload?.userId || payload?.sub || payload?.['custom:userid'];
      if (uid) return String(uid);
    }
  } catch {}
  const headerUid = req.headers['x-user-id'];
  if (typeof headerUid === 'string' && headerUid) return headerUid as string;
  const bodyUid = (req.body && (req.body.userId || req.body.userid));
  if (typeof bodyUid === 'string' && bodyUid) return bodyUid;
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {  // [MOD] 戻り値を Promise<void> に固定
  if (req.method !== "POST") { res.status(405).end(); return; }  // [MOD] Next APIはvoidを返す

  const userId = extractUserId(req);
  const purpose = (req.body?.purpose ?? req.query?.purpose ?? '').toString();
  const input = req.body?.input ?? {};

  if (!userId || !purpose) {
    res.status(400).json({ error: "userid and purpose required", detail: { hasUserId: !!userId, hasPurpose: !!purpose } }); return;  // [MOD] Next API は void を返す
  }

  let openaiApiKey = "", selectedModel = "gpt-5-mini", masterPrompt = "";
  try {
    const result = await client.send(new GetItemCommand({
      TableName: 'UserSettings',
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      ProjectionExpression: "#k, #m1, #m2, #mp",
      ExpressionAttributeNames: {
        "#k": "openaiApiKey",
        "#m1": "modelDefault",
        "#m2": "selectedModel",
        "#mp": "masterPrompt",
      }
    }));
    openaiApiKey = result.Item?.openaiApiKey?.S || "";
    // Prefer explicit selectedModel (user choice) over modelDefault
    const rawModel = result.Item?.selectedModel?.S || result.Item?.modelDefault?.S || "gpt-5-mini";
    const allow = new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"]);
    selectedModel = allow.has(rawModel) ? rawModel : "gpt-5-mini";
    masterPrompt = result.Item?.masterPrompt?.S || "";
    if (!openaiApiKey) throw new Error("APIキー未設定です");
  } catch (e: unknown) {
    res.status(500).json({ error: "APIキーの取得に失敗: " + String(e) }); return;  // [MOD] Next API は void を返す
  }

  let systemPrompt = "";
  let userPrompt = "";
  let max_tokens = 800;

  if (purpose === "post-generate") {
    // ====== ここを全面的に刷新 ======
    const accountId = (input?.accountId ?? "").toString();
    if (!accountId) {
      res.status(400).json({ error: "accountId is required" }); return;  // [MOD] Next API は void を返す
    }

    // personaMode によって使い分け
    let personaText = "";
    try {
      const acc = await client.send(new GetItemCommand({
        TableName: process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts',
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        ProjectionExpression: "#pm, #ps, #pd",
        ExpressionAttributeNames: {
          "#pm": "personaMode",
          "#ps": "personaSimple",
          "#pd": "personaDetail",
        }
      }));
      const mode = (acc.Item?.personaMode?.S || "").toLowerCase();
      const simple = acc.Item?.personaSimple?.S || "";
      const detail = acc.Item?.personaDetail?.S || "";

      if (mode === "detail") {
        personaText = detail ? `【詳細ペルソナ(JSON)】\n${detail}` : "";
      } else if (mode === "simple") {
        personaText = simple ? `【簡易ペルソナ】${simple}` : "";
      } else if (mode === "off") {
        personaText = "";
      } else {
        // 想定外の値 → detail>simple の順にフォールバック
        personaText = detail
          ? `【詳細ペルソナ(JSON)】\n${detail}`
          : (simple ? `【簡易ペルソナ】${simple}` : "");
      }
    } catch (e) {
      console.log("fetch persona failed:", e);
      // 取得失敗時は未使用扱い
      personaText = "";
    }

    systemPrompt = "あなたはSNS運用代行のプロです。";
    const policy = masterPrompt ? `\n【運用方針（masterPrompt）】\n${masterPrompt}\n` : "";

    // Theme handling: if theme is a comma/、/; separated list, pick one at random server-side
    const incomingPrompt = (input?.prompt ?? "").toString().trim();
    let themeRaw = (input?.theme ?? "").toString();
    let themeUsed = themeRaw;
    if (!incomingPrompt && themeRaw) {
      // Split only on ASCII comma according to request
      const parts = themeRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        themeUsed = parts[Math.floor(Math.random() * parts.length)];
      }
    }

    if (incomingPrompt) {
      // If frontend provided a full prompt, prefer it (it may already include masterPrompt/persona/theme)
      userPrompt = incomingPrompt;
    } else {
      userPrompt = [
        policy,
        personaText ? `# ペルソナ\n${personaText}` : "",
        `# テーマ\n${themeUsed}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      userPrompt = String(userPrompt || "").trim();
    }

    // expose chosen theme in debug raw
    (input as any)._themeUsed = themeUsed;

    max_tokens = 300;
    // ====== 刷新ここまで ======

  } else if (purpose === "reply-generate") {
    // リプライ生成（新機能）
    const accountId = (input?.accountId ?? "").toString();
    const originalPost = (input?.originalPost ?? "").toString();
    const incomingReply = (input?.incomingReply ?? "").toString();
    
    if (!accountId || !originalPost || !incomingReply) {
      res.status(400).json({ error: "accountId, originalPost, and incomingReply are required for reply-generate" }); return;
    }

    // アカウントのペルソナ情報を取得
    let personaText = "";
    try {
      const acc = await client.send(new GetItemCommand({
        TableName: process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts',
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
        ProjectionExpression: "#pm, #ps, #pd",
        ExpressionAttributeNames: {
          "#pm": "personaMode",
          "#ps": "personaSimple",
          "#pd": "personaDetail",
        }
      }));
      const mode = (acc.Item?.personaMode?.S || "").toLowerCase();
      const simple = acc.Item?.personaSimple?.S || "";
      const detail = acc.Item?.personaDetail?.S || "";

      if (mode === "detail") {
        personaText = detail ? `【詳細ペルソナ(JSON)】\n${detail}` : "";
      } else if (mode === "simple") {
        personaText = simple ? `【簡易ペルソナ】${simple}` : "";
      } else {
        personaText = detail
          ? `【詳細ペルソナ(JSON)】\n${detail}`
          : (simple ? `【簡易ペルソナ】${simple}` : "");
      }
    } catch (e) {
      console.log("fetch persona for reply failed:", e);
      personaText = "";
    }

    systemPrompt = "あなたはSNS運用代行のプロです。受信したリプライに対して、アカウントのペルソナに合った自然で魅力的な返信を作成してください。";
    const policy = masterPrompt ? `\n【運用方針（masterPrompt）】\n${masterPrompt}\n` : "";

    userPrompt = `
${policy}
${personaText ? `【アカウントのペルソナ】\n${personaText}\n` : "【アカウントのペルソナ】\n(未設定)\n"}
【元の投稿】
${originalPost}

【受信したリプライ】
${incomingReply}

【指示】
上記のリプライに対して、アカウントのペルソナに合った返信を作成してください。
- 自然で親しみやすい文体で
- 相手のメッセージに適切に応答し
- 会話を続けやすい内容で
- 絵文字も適度に使用
- 150文字以内で簡潔に

返信内容のみを出力してください（説明や前置きは不要）。`;
    max_tokens = 300;

  } else if (purpose === "persona-generate") {
    systemPrompt = "あなたはSNS運用の専門家です。";
    userPrompt = `
あなたはSNSアカウントのキャラクターペルソナを作成するAIです。
（…既存文面は変更なし…）
    `.trim();
    max_tokens = 800;

  } else {
    res.status(400).json({ error: `unsupported purpose: ${purpose}` }); return;  // [MOD] Next API は void を返す
  }

  try {
    // Build request body with inference vs non-inference differences
    const isInferenceModel = String(selectedModel).startsWith("gpt-5");
    const openaiBodyFactory = (model: string, opts: { maxOut?: number } = {}) => {
      const base: any = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: isInferenceModel ? 1 : 0.7,
      };
      if (isInferenceModel) {
        // For inference models prefer max_completion_tokens and include low reasoning effort
        base.max_completion_tokens = opts.maxOut ?? Math.max(max_tokens, 1024);
        base.reasoning = { effort: "low" };
      } else {
        base.max_tokens = opts.maxOut ?? max_tokens;
      }
      return JSON.stringify(base);
    };

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: openaiBodyFactory(selectedModel),
    });

    // Read raw text first for debug
    const raw = await openaiRes.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      // Not JSON — capture raw
      data = { raw }
    }
    // Attach which model was selected for debugging
    try { data._selectedModel = selectedModel; } catch {}

    if (!openaiRes.ok) {
      const msg = data?.error?.message || (data?.raw ? data.raw : JSON.stringify(data));
      // Return OpenAI raw body in error for easier debugging
      res.status(502).json({ error: `OpenAI API error: ${msg}`, raw: data }); return;  // [MOD] Next API は void を返す
    }

    if (purpose === "persona-generate") {
      const text = data.choices?.[0]?.message?.content || "";
      // （既存の抽出処理はそのまま）
      res.status(200).json({ text }); return;  // [MOD] Next API は void を返す
    }

    let text = data.choices?.[0]?.message?.content || "";
    // If empty, retry once with smaller max tokens to avoid length truncation returning empty content
    if (!text) {
      try {
        const retryBody = openaiBodyFactory(selectedModel, { maxOut: 150 });
        const retryRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiApiKey}`,
          },
          body: retryBody,
        });
        const retryRaw = await retryRes.text();
        let retryData: any = {};
        try { retryData = retryRaw ? JSON.parse(retryRaw) : {}; } catch { retryData = { raw: retryRaw }; }
        const retryText = retryData.choices?.[0]?.message?.content || "";
        if (retryText) {
          text = retryText;
          // include both attempts in raw for debugging
          data._retry = retryData;
        }
      } catch (e) {
        // ignore retry errors, continue to return what we have
        console.log("retry openai failed:", e);
      }
    }

    // If still empty and this was an inference model, fallback to a non-inference model (gpt-4o-mini)
    if (!text && isInferenceModel) {
      try {
        const fbModel = "gpt-4o-mini";
        const fbRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiApiKey}`,
          },
          body: openaiBodyFactory(fbModel, { maxOut: 300 }),
        });
        const fbRaw = await fbRes.text();
        let fbData: any = {};
        try { fbData = fbRaw ? JSON.parse(fbRaw) : {}; } catch { fbData = { raw: fbRaw }; }
        const fbText = fbData.choices?.[0]?.message?.content || "";
        if (fbText) {
          text = fbText;
          data._fallback = { model: fbModel, raw: fbData };
        } else {
          data._fallback = { model: fbModel, raw: fbData };
        }
      } catch (e) {
        console.log("fallback openai failed:", e);
      }
    }

    // Also include raw response for debugging
    res.status(200).json({ text, raw: data }); return;  // [MOD] Next API は void を返す

  } catch (e: unknown) {
    res.status(500).json({ error: "OpenAI API呼び出し失敗: " + String(e) }); return;  // [MOD] Next API は void を返す
  }
}
