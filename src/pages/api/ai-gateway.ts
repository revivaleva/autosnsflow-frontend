// src/pages/api/ai-gateway.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import jwt from 'jsonwebtoken'; // 【追加】JWTからuserIdを抽出するために利用

// Amplify Gen1 用クレデンシャル（既存）
// ※既存コメントや構成は変更していません
const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

// 【追加】JWT/ヘッダー/ボディの順で userId を抽出（後方互換）
// 署名検証が必要な場合は jwt.decode → jwt.verify に差し替えてください
function extractUserId(req: NextApiRequest): string | null {
  // Authorization: Bearer <JWT>
  const rawAuth = (req.headers.authorization || (req.headers as any).Authorization) as string | undefined;
  if (rawAuth && rawAuth.startsWith('Bearer ')) {
    const token = rawAuth.slice('Bearer '.length);
    try {
      const payload: any = jwt.decode(token); // ←必要に応じ verify に変更
      // Cognito想定: sub ／ 独自クレーム: userId or custom:userid
      const uid = payload?.userId || payload?.sub || payload?.['custom:userid'];
      if (uid) return String(uid);
    } catch {
      // 無効トークンは無視して次の手段へ
    }
  }

  // リバプロ等で付与されるヘッダー
  const headerUid = req.headers['x-user-id'];
  if (typeof headerUid === 'string' && headerUid) return headerUid;

  // 最後に旧仕様を許可（後方互換）
  const bodyUid = (req.body && (req.body.userId || req.body.userid));
  if (typeof bodyUid === 'string' && bodyUid) return bodyUid;

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // 【変更】bodyではなく統一関数から取得（ヘッダー優先／後方互換）
  const userId = extractUserId(req);
  // purpose は従来通り body から（必要に応じて query を併用）
  const purpose = (req.body?.purpose ?? req.query?.purpose ?? '').toString();
  const input = req.body?.input ?? {};

  if (!userId || !purpose) {
    // 【変更】UI表示に合わせメッセージを統一＋詳細も返す
    return res.status(400).json({
      error: "userid and purpose required",
      detail: { hasUserId: !!userId, hasPurpose: !!purpose }
    });
  }

  // 1. 設定取得
  let openaiApiKey = "", selectedModel = "gpt-3.5-turbo";
  try {
    const result = await client.send(new GetItemCommand({
      TableName: 'UserSettings',
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      // 【追加】取得フィールドを明示（存在しない場合もあるため安全にfallback）
      ProjectionExpression: "openAiApiKey, modelDefault, selectedModel"
    }));
    openaiApiKey = result.Item?.openaiApiKey?.S || "";
    // 【変更】modelDefault と selectedModel の両方に対応（後方互換）
    selectedModel =
      result.Item?.modelDefault?.S ||
      result.Item?.selectedModel?.S ||
      "gpt-3.5-turbo";

    if (!openaiApiKey) throw new Error("APIキー未設定です");
  } catch (e: unknown) {
    return res.status(500).json({ error: "APIキーの取得に失敗: " + String(e) });
  }

  // 2. 用途に応じたプロンプト生成（既存仕様を維持）
  let systemPrompt = "";
  let userPrompt = "";
  let max_tokens = 800;

  if (purpose === "persona-generate") {
    systemPrompt = "あなたはSNS運用の専門家です。";
    userPrompt = `
あなたはSNSアカウントのキャラクターペルソナを作成するAIです。

【前提キャラクターイメージ】
「${input?.personaSeed ?? ""}」

このキャラクターイメージをもとに、下記の14項目を全て含むJSON形式（コードブロック）で、詳細なペルソナを必ず出力してください。
各キーは必ず下記の「英語名（key）」を使い、値がなければ空文字 "" としてください。

- name（名前）
- age（年齢）
- gender（性別）
- job（職業）
- lifestyle（生活スタイル）
- character（投稿キャラ・キャラクター）
- tone（口調・内面）
- vocab（語彙傾向）
- emotion（感情パターン）
- erotic（エロ表現）
- target（ターゲット層）
- purpose（投稿目的）
- distance（絡みの距離感）
- ng（NG要素）

また、1行で要約した「簡易ペルソナ」テキストも出力してください。

出力形式は必ず下記の2ブロックで示してください。

---
【簡易ペルソナ】1行テキスト
（ここに1行で要約したペルソナを書く）

【詳細ペルソナ】JSON形式
\`\`\`json
{
  "name": "",
  "age": "",
  "gender": "",
  "job": "",
  "lifestyle": "",
  "character": "",
  "tone": "",
  "vocab": "",
  "emotion": "",
  "erotic": "",
  "target": "",
  "purpose": "",
  "distance": "",
  "ng": ""
}
\`\`\`
    `.trim();
    max_tokens = 800;
  } else if (purpose === "post-generate") {
    systemPrompt = "あなたはSNS運用代行のプロです。";
    userPrompt = `
キャラクター: ${input?.persona ?? ""}
テーマ: ${input?.theme ?? ""}
この条件でSNS投稿本文を1つ日本語で生成してください。
    `.trim();
    max_tokens = 300;
  } else {
    // 【追加】未対応purposeの明示
    return res.status(400).json({ error: `unsupported purpose: ${purpose}` });
  }

  // 3. OpenAI API 呼び出し
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

    // 【追加】OpenAIエラーを早期に検出して返却
    if (!openaiRes.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      return res.status(502).json({ error: `OpenAI API error: ${msg}` });
    }

    const text = data.choices?.[0]?.message?.content || "";

    if (purpose === "persona-generate") {
      const detailBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
      let personaDetail: Record<string, any> = {};
      let personaSimple = "";
      let detailRaw = "";

      if (detailBlockMatch) {
        detailRaw = detailBlockMatch[1].trim();
        try {
          personaDetail = JSON.parse(detailRaw);
        } catch (e) {
          // 既存ログ形式を踏襲
          console.log("JSON parse error!", e, detailRaw);
          personaDetail = {};
        }
      }

      const simpleMatch = text.match(/【簡易ペルソナ】(?:\s*\n)?([\s\S]*?)(?=【詳細ペルソナ】|```|$)/i);
      if (simpleMatch) {
        personaSimple = simpleMatch[1].trim();
      }

      return res.status(200).json({
        personaDetail,
        personaSimple,
        personaDetailText: detailRaw,
      });
    }

    // post-generate
    return res.status(200).json({ text });
  } catch (e: unknown) {
    return res.status(500).json({ error: "OpenAI API呼び出し失敗: " + String(e) });
  }
}
