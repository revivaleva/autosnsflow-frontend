// /src/pages/api/login.ts

import type { NextApiRequest, NextApiResponse } from 'next'
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'ap-northeast-1' });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { email, password } = req.body;

  // サンプルではemailで検索
  const params = {
    TableName: "UserSettings",
    Key: { PK: { S: "USER#demo" }, SK: { S: "SETTINGS" } }
  };
  const result = await client.send(new GetItemCommand(params));
  const item = result.Item;
  if (!item) return res.status(401).json({ success: false });
  if (item.email.S === email && item.password.S === password) {
    return res.status(200).json({ success: true, userId: "demo" });
  }
  return res.status(401).json({ success: false });
}
