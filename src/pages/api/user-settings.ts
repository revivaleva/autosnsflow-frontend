// /src/pages/api/user-settings.ts
// [MOD] ユーザー自己更新APIからは dailyOpenAiLimit / defaultOpenAiCost を更新不可に変更
//      GETでは参照値として返却（画面で読み取り専用表示する用途）
//      PUTのUpdateExpressionから上限項目を除外

import type { NextApiRequest, NextApiResponse } from "next";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION || "ap-northeast-1";
const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";

// 認証ユーザーのID取得はアプリの実装に合わせて差し替え
const getUserId = async (req: NextApiRequest) => {
  // TODO: Cognito/JWTなどから取得
  return "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
};

const ddb = new DynamoDBClient({ region });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserId(req);

  if (req.method === "GET") {
    const out = await ddb.send(
      new GetItemCommand({
        TableName: TBL_SETTINGS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      })
    );

    const it = out.Item || {};
    const body = {
      discordWebhooks: (it.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean),
      planType: it.planType?.S || "free",
      // [ADD] 参照用に返す（編集は不可）
      dailyOpenAiLimit: it.dailyOpenAiLimit?.N ? Number(it.dailyOpenAiLimit.N) : 200,
      defaultOpenAiCost: it.defaultOpenAiCost?.N ? Number(it.defaultOpenAiCost.N) : 1,
    };
    return res.status(200).json(body);
  }

  if (req.method === "PUT") {
    const { discordWebhooks, planType } = req.body || {};

    const wl = Array.isArray(discordWebhooks) ? discordWebhooks : [];

    // [MOD] 上限値は管理APIのみで変更可能のためUpdate対象から除外
    await ddb.send(
      new UpdateItemCommand({
        TableName: TBL_SETTINGS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
        UpdateExpression:
          "SET discordWebhooks = :w, planType = :p, updatedAt = :ts",
        ExpressionAttributeValues: {
          ":w": { L: wl.map((s: string) => ({ S: s })) },
          ":p": { S: (planType || "free").toString() },
          ":ts": { N: String(Math.floor(Date.now() / 1000)) },
        },
      })
    );
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).json({ error: "Method Not Allowed" });
}
