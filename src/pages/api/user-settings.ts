// /src/pages/api/user-settings.ts

import type { NextApiRequest, NextApiResponse } from 'next'
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'
import jwt from 'jsonwebtoken'

const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AUTOSNSFLOW_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AUTOSNSFLOW_SECRET_ACCESS_KEY!,
  }
});

// Cognito JWTの検証（シンプルなデコードのみ。検証までやる場合はJWKも必要です）
function getUserIdFromToken(token?: string): string | null {
  if (!token) return null
  try {
    const decoded = jwt.decode(token) as any
    // Cognitoユーザープールのsub or cognito:usernameが一意のユーザーID
    return decoded?.sub || decoded?.['cognito:username'] || null
  } catch {
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CookieからidTokenを取得
  const cookies = req.headers.cookie?.split(';').map(s => s.trim()) ?? []
  const idToken = cookies.find(c => c.startsWith('idToken='))?.split('=')[1]

  const userId = getUserIdFromToken(idToken)
  if (!userId) return res.status(401).json({ error: '認証が必要です（idTokenが無効）' })

  // GET: 設定取得
  if (req.method === 'GET') {
    try {
      const result = await client.send(new GetItemCommand({
        TableName: 'UserSettings',
        Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } }
      }))
      const item = result.Item

      // [ADD] 初回アクセス時はデフォルトで自動作成（Number型で保存）
      if (!item) {
        const defaults = {
          PK: { S: `USER#${userId}` },
          SK: { S: "SETTINGS" },
          discordWebhook:      { S: "" },           // 単一文字列
          errorDiscordWebhook: { S: "" },
          openaiApiKey:        { S: "" },
          selectedModel:       { S: "gpt-3.5-turbo" },
          masterPrompt:        { S: "" },
          replyPrompt:         { S: "" },
          autoPost:            { S: "active" },
          doublePostDelay:     { N: "0" }           // [ADD] DBはNumberで統一
        }
        await client.send(new PutItemCommand({
          TableName: 'UserSettings',
          Item: defaults,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" // [ADD] 競合防止
        }))
        // 返却はUI互換のため string で統一
        return res.status(200).json({
          discordWebhook: "",
          errorDiscordWebhook: "",
          openaiApiKey: "",
          selectedModel: "gpt-3.5-turbo",
          masterPrompt: "",
          replyPrompt: "",
          autoPost: "active",
          doublePostDelay: "0" // [ADD] 返却は文字列
        })
      }

      // 既存レコードあり：doublePostDelay は N/S どちらでも読めるよう後方互換
      const delayStr =
        item?.doublePostDelay?.N !== undefined
          ? String(Number(item.doublePostDelay.N) || 0)
          : (item?.doublePostDelay?.S ?? "0")

      return res.status(200).json({
        discordWebhook: item?.discordWebhook?.S ?? "",
        errorDiscordWebhook: item?.errorDiscordWebhook?.S ?? "",
        openaiApiKey: item?.openaiApiKey?.S ?? "",
        selectedModel: item?.selectedModel?.S ?? "gpt-3.5-turbo",
        masterPrompt: item?.masterPrompt?.S ?? "",
        replyPrompt: item?.replyPrompt?.S ?? "",
        autoPost: item?.autoPost?.S ?? "active",
        doublePostDelay: delayStr // [MOD] 返却は文字列に統一
      })
    } catch (e: unknown) {
      return res.status(500).json({ error: String(e) })
    }
  }

  // PUT: 設定保存
  if (req.method === 'PUT') {
    // bodyがstringで来る場合も考慮
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body

    const {
      discordWebhook = "",
      errorDiscordWebhook = "",
      openaiApiKey = "",
      selectedModel = "gpt-3.5-turbo",
      masterPrompt = "",
      replyPrompt = "",
      autoPost = "active",
      doublePostDelay = "0", // 追加（string/number両対応）
    } = body;

    try {
      // [MOD] 保存時は Number 型に正規化して保存
      const delayNum = Number(doublePostDelay) || 0

      await client.send(new PutItemCommand({
        TableName: 'UserSettings',
        Item: {
          PK: { S: `USER#${userId}` },
          SK: { S: "SETTINGS" },
          discordWebhook:      { S: discordWebhook },
          errorDiscordWebhook: { S: errorDiscordWebhook },
          openaiApiKey:        { S: openaiApiKey },
          selectedModel:       { S: selectedModel },
          masterPrompt:        { S: masterPrompt },
          replyPrompt:         { S: replyPrompt },
          autoPost:            { S: autoPost },
          doublePostDelay:     { N: String(delayNum) } // [MOD] Numberで保存
        }
      }))
      return res.status(200).json({ success: true })
    } catch (e: unknown) {
      return res.status(500).json({ error: String(e) })
    }
  }

  res.status(405).end()
}
