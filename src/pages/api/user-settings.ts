// /src/pages/api/user-settings.ts

import type { NextApiRequest, NextApiResponse } from 'next'
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'ap-northeast-1' })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // bodyがstringで来る場合も考慮
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const userId = (req.query.userId as string) || body?.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // GET: 設定取得
  if (req.method === 'GET') {
    try {
      const result = await client.send(new GetItemCommand({
        TableName: 'UserSettings',
        Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } }
      }));
      const item = result.Item;
      return res.status(200).json({
        discordWebhook: item?.discordWebhook?.S ?? "",
        errorDiscordWebhook: item?.errorDiscordWebhook?.S ?? "",
        openaiApiKey: item?.openaiApiKey?.S ?? "",
        selectedModel: item?.selectedModel?.S ?? "gpt-3.5-turbo",
        masterPrompt: item?.masterPrompt?.S ?? "",
        replyPrompt: item?.replyPrompt?.S ?? "",
        autoPost: item?.autoPost?.S ?? "active",
      });
    } catch (e: unknown) {
      return res.status(500).json({ error: String(e) });
    }
  }

  // PUT: 設定保存
  if (req.method === 'PUT') {
    const {
      discordWebhook = "",
      errorDiscordWebhook = "",
      openaiApiKey = "",
      selectedModel = "gpt-3.5-turbo",
      masterPrompt = "",
      replyPrompt = "",
      autoPost = "active",
    } = body;

    try {
      await client.send(new PutItemCommand({
        TableName: 'UserSettings',
        Item: {
          PK: { S: `USER#${userId}` },
          SK: { S: "SETTINGS" },
          discordWebhook: { S: discordWebhook },
          errorDiscordWebhook: { S: errorDiscordWebhook },
          openaiApiKey: { S: openaiApiKey },
          selectedModel: { S: selectedModel },
          masterPrompt: { S: masterPrompt },
          replyPrompt: { S: replyPrompt },
          autoPost: { S: autoPost },
        }
      }));
      return res.status(200).json({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ error: String(e) });
    }
  }

  res.status(405).end();
}
