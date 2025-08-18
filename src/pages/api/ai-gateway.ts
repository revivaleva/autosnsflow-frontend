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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const userId = extractUserId(req);
  const purpose = (req.body?.purpose ?? req.query?.purpose ?? '').toString();
  const input = req.body?.input ?? {};

  if (!userId || !purpose) {
    return res.status(400).json({ error: "userid and purpose required", detail: { hasUserId: !!userId, hasPurpose: !!purpose } });
  }

  let openaiApiKey = "", selectedModel = "gpt-3.5-turbo", masterPrompt = "";
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
    selectedModel = result.Item?.modelDefault?.S || result.Item?.selectedModel?.S || "gpt-3.5-turbo";
    masterPrompt = result.Item?.masterPrompt?.S || "";
    if (!openaiApiKey) throw new Error("APIキー未設定です");
  } catch (e: unknown) {
    return res.status(500).json({ error: "APIキーの取得に失敗: " + String(e) });
  }

  let systemPrompt = "";
  let userPrompt = "";
  let max_tokens = 800;

  if (purpose === "post-generate") {
    // ====== ここを全面的に刷新 ======
    const accountId = (input?.accountId ?? "").toString();
    if (!accountId) {
      return res.status(400).json({ error: "accountId is required" });
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

    userPrompt = `
${policy}
${personaText ? `【アカウントのペルソナ】\n${personaText}\n` : "【アカウントのペルソナ】\n(未設定)\n"}
【投稿テーマ】
${input?.theme ?? ""}

【指示】
上記の方針とペルソナ・テーマに従い、SNS投稿本文を日本語で1つだけ生成してください。
- 文末表現や語感はペルソナに合わせる
- 長すぎない（140〜220文字目安）
- 絵文字は多用しすぎない（0〜3個程度）
- ハッシュタグは不要
    `.trim();

    max_tokens = 300;
    // ====== 刷新ここまで ======

  } else if (purpose === "persona-generate") {
    systemPrompt = "あなたはSNS運用の専門家です。";
    userPrompt = `
あなたはSNSアカウントのキャラクターペルソナを作成するAIです。
（…既存文面は変更なし…）
    `.trim();
    max_tokens = 800;

  } else {
    return res.status(400).json({ error: `unsupported purpose: ${purpose}` });
  }

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens,
        temperature: 0.7,
      }),
    });

    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      return res.status(502).json({ error: `OpenAI API error: ${msg}` });
    }

    if (purpose === "persona-generate") {
      const text = data.choices?.[0]?.message?.content || "";
      // （既存の抽出処理はそのまま）
      return res.status(200).json({ text });
    }

    const text = data.choices?.[0]?.message?.content || "";
    return res.status(200).json({ text });

  } catch (e: unknown) {
    return res.status(500).json({ error: "OpenAI API呼び出し失敗: " + String(e) });
  }
}
