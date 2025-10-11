const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_OPENAI_TEMP = 0.7;
const DEFAULT_OPENAI_MAXTOKENS = 300;

function isInferenceModel(name: string) {
  const s = String(name || "").toLowerCase();
  return s.startsWith("gpt-5") || s.startsWith("gpt-4o") || s.startsWith("o4") || s.startsWith("gpt-4.1");
}

function sanitizeModelName(model: any): string {
  const allow = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];
  const m = String(model || "");
  return allow.includes(m) ? m : DEFAULT_OPENAI_MODEL;
}

export async function callOpenAIText({ apiKey, model, systemPrompt, userPrompt, temperature, max_tokens }: any) {
  const m = sanitizeModelName(model || DEFAULT_OPENAI_MODEL);
  const inference = isInferenceModel(m);

  const buildBody = (mdl: string, opts: any = {}) => {
    const base: any = {
      model: mdl,
      messages: [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: String(userPrompt || '') },
      ],
      temperature: inference ? 1 : (typeof temperature === 'number' ? temperature : DEFAULT_OPENAI_TEMP),
    };
    if (inference) {
      base.max_completion_tokens = opts.maxOut ?? Math.max(max_tokens || DEFAULT_OPENAI_MAXTOKENS, 1024);
    } else {
      base.max_tokens = opts.maxOut ?? (max_tokens || DEFAULT_OPENAI_MAXTOKENS);
    }
    return JSON.stringify(base);
  };

  const doFetch = async (mdl: string, opts: any = {}) => {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: buildBody(mdl, opts),
    });
    const raw = await resp.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    return { ok: resp.ok, data, raw, status: resp.status };
  };

  const primary = await doFetch(m);
  if (!primary.ok) {
    try {
      const msg = primary.data?.error?.message || (primary.data?.raw ? primary.data.raw : JSON.stringify(primary.data));
      const errLower = String(msg || "").toLowerCase();
      const modelAccessIssues = ["does not exist", "do not have access", "not exist", "not found", "not allowed", "permission"].some(k => errLower.includes(k));
      if (modelAccessIssues) {
        const fallbacks = ["gpt-4o-mini", "gpt-5-mini"];
        for (const fb of fallbacks) {
          try {
            const f = await doFetch(fb, { maxOut: Math.max(max_tokens || DEFAULT_OPENAI_MAXTOKENS, 300) });
            if (f.ok) return { text: f.data.choices?.[0]?.message?.content || "", raw: f.data };
          } catch (_) {}
        }
      }
    } catch (_) {}
    throw new Error(`OpenAI API error: status=${primary.status}`);
  }

  let text = primary.data.choices?.[0]?.message?.content || "";

  if (!text && inference) {
    try {
      const retry = await doFetch(m, { maxOut: 150 });
      const retryText = retry.data?.choices?.[0]?.message?.content || "";
      if (retryText) return { text: retryText, raw: retry.data };
    } catch (_) {}
  }

  if (!text && inference) {
    try {
      const fbModel = "gpt-4o-mini";
      const fb = await doFetch(fbModel, { maxOut: 300 });
      const fbText = fb.data?.choices?.[0]?.message?.content || "";
      if (fbText) return { text: fbText, raw: fb.data };
    } catch (_) {}
  }

  return { text: text || "", raw: primary.data };
}


