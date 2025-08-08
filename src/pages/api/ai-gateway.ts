import type { NextApiRequest, NextApiResponse } from 'next';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

// Amplify Gen1 用クレデンシャル
const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { userId, purpose, input } = req.body;
  if (!userId || !purpose) {
    return res.status(400).json({ error: "userId and purpose required" });
  }

  // 1. 設定取得
  let openaiApiKey = "", selectedModel = "gpt-3.5-turbo";
  try {
    const result = await client.send(new GetItemCommand({
      TableName: 'UserSettings',
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } }
    }));
    openaiApiKey = result.Item?.openaiApiKey?.S || "";
    selectedModel = result.Item?.selectedModel?.S || "gpt-3.5-turbo";
    if (!openaiApiKey) throw new Error("APIキー未設定です");
  } catch (e: unknown) {
    return res.status(500).json({ error: "APIキーの取得に失敗: " + String(e) });
  }

  // 2. 用途に応じたプロンプト生成
  let systemPrompt = "";
  let userPrompt = "";
  let max_tokens = 800;

  if (purpose === "persona-generate") {
    systemPrompt = "あなたはSNS運用の専門家です。";
    userPrompt = `
あなたはSNSアカウントのキャラクターペルソナを作成するAIです。

【前提キャラクターイメージ】
「${input?.personaSeed}」

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
キャラクター: ${input?.persona}
テーマ: ${input?.theme}
この条件でSNS投稿本文を1つ日本語で生成してください。
    `.trim();
    max_tokens = 300;
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
    const text = data.choices?.[0]?.message?.content || "";

    if (purpose === "persona-generate") {
      const detailBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
      let personaDetail = {};
      let personaSimple = "";
      let detailRaw = "";

      if (detailBlockMatch) {
        detailRaw = detailBlockMatch[1].trim();
        try {
          personaDetail = JSON.parse(detailRaw);
        } catch (e) {
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

    return res.status(200).json({ text });
  } catch (e: unknown) {
    return res.status(500).json({ error: "OpenAI API呼び出し失敗: " + String(e) });
  }
}
