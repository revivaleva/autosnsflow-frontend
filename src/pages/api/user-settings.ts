// /src/pages/api/user-settings.ts
// [MOD] 設定APIを「{ settings } で返す」& 未作成時は既定値を返すよう統一
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb"; // [ADD]
import { verifyUserFromRequest } from "@/lib/auth"; // [ADD]

const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";
const ddb = createDynamoClient(); // [ADD]

// [ADD] UI側が求める既定値
const DEFAULTS = {
  discordWebhook: "",
  errorDiscordWebhook: "",
  openaiApiKey: "",
  selectedModel: "gpt-3.5-turbo",
  masterPrompt: "",
  replyPrompt: "",
  autoPost: "active" as "active" | "inactive",
  doublePostDelay: "0",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyUserFromRequest(req); // [ADD]
    const userId = user.sub;                        // [ADD]
    const Key = { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } };

    if (req.method === "GET") {
      const out = await ddb.send(new GetItemCommand({ TableName: TBL_SETTINGS, Key }));
      const it: any = out.Item;

      if (!it) {
        // [ADD] 初回ユーザーは既定値で返す
        return res.status(200).json({ settings: { ...DEFAULTS } });
      }

      // [MOD] 互換キーも吸収して { settings } を返す
      const list = (it.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean);
      const discordWebhook = it.discordWebhook?.S || list[0] || "";
      const errorDiscordWebhook = it.errorDiscordWebhook?.S || list[1] || "";
      const openaiApiKey = it.openaiApiKey?.S || it.openAiApiKey?.S || "";
      const selectedModel =
        it.selectedModel?.S || it.modelDefault?.S || DEFAULTS.selectedModel;

      const autoPost =
        it.autoPost?.S
          ? (it.autoPost.S as "active" | "inactive")
          : (it.autoPost?.BOOL ? "active" : "inactive");

      const settings = {
        discordWebhook,
        errorDiscordWebhook,
        openaiApiKey,
        selectedModel,
        masterPrompt: it.masterPrompt?.S || "",
        replyPrompt: it.replyPrompt?.S || "",
        autoPost,
        doublePostDelay: it.doublePostDelay?.N ? String(it.doublePostDelay.N) : "0",
      };

      return res.status(200).json({ settings });
    }

    if (req.method === "PUT") {
      // [MOD] UIからの値と既存互換キーを両方受ける
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const discordWebhook =
        body.discordWebhook ?? (Array.isArray(body.discordWebhooks) ? body.discordWebhooks[0] : "");
      const errorDiscordWebhook =
        body.errorDiscordWebhook ?? (Array.isArray(body.discordWebhooks) ? body.discordWebhooks[1] : "");
      const openaiApiKey = body.openaiApiKey ?? body.openAiApiKey ?? "";
      const selectedModel = body.selectedModel ?? body.modelDefault ?? DEFAULTS.selectedModel;
      const masterPrompt = body.masterPrompt ?? "";
      const replyPrompt = body.replyPrompt ?? "";
      const autoPost = (body.autoPost ?? DEFAULTS.autoPost) as "active" | "inactive";
      const doublePostDelay = String(body.doublePostDelay ?? "0");

      // [ADD] 存在しなければ先に空レコードを作成（Put: if-not-exists）
      await ddb.send(
        new PutItemCommand({
          TableName: TBL_SETTINGS,
          Item: { ...Key },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        })
      ).catch(() => { /* 既存なら無視 */ });

      // [MOD] まとめて更新（互換キーも同時に保持）
      await ddb.send(
        new UpdateItemCommand({
          TableName: TBL_SETTINGS,
          Key,
          UpdateExpression: [
            "SET discordWebhook = :dw",
            "errorDiscordWebhook = :edw",
            "discordWebhooks = :dwl", // 互換
            "openaiApiKey = :oak",    // 新
            "openAiApiKey = :oak",    // 互換
            "selectedModel = :sm",    // 新
            "modelDefault = :sm",     // 互換
            "masterPrompt = :mp",
            "replyPrompt = :rp",
            "autoPost = :apS",        // 文字列で保存（active/inactive）
            "doublePostDelay = :dp",
            "updatedAt = :ts",
          ].join(", "),
          ExpressionAttributeValues: {
            ":dw": { S: discordWebhook || "" },
            ":edw": { S: errorDiscordWebhook || "" },
            ":dwl": {
              L: [discordWebhook, errorDiscordWebhook].filter(Boolean).map((s: string) => ({ S: s })),
            },
            ":oak": { S: openaiApiKey || "" },
            ":sm": { S: selectedModel || DEFAULTS.selectedModel },
            ":mp": { S: masterPrompt || "" },
            ":rp": { S: replyPrompt || "" },
            ":apS": { S: autoPost }, // "active" | "inactive"
            ":dp": { N: String(Number(doublePostDelay) || 0) },
            ":ts": { N: String(Math.floor(Date.now() / 1000)) },
          },
        })
      );

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e: any) {
    console.error("user-settings error:", e?.detail || e);
    const msg = String(e?.message || "");
    const code =
      e?.statusCode ||
      (msg === "Unauthorized" ? 401 : msg.includes("credentials") ? 500 : 500);
    return res.status(code).json({
      error:
        msg === "jwks_fetch_failed"
          ? "認証設定エラー（JWKS取得失敗）"
          : msg || "internal_error",
    });
  }
}
