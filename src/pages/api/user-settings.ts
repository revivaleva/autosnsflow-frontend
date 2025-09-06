// /src/pages/api/user-settings.ts
// [MOD] 設定APIを「{ settings } で返す」& 未作成時は既定値を返すよう統一
import type { NextApiRequest, NextApiResponse } from "next";
import { GetItemCommand, UpdateItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "@/lib/ddb"; // [ADD]
import { verifyUserFromRequest } from "@/lib/auth"; // [ADD]

const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";
const ddb = createDynamoClient(); // [ADD]

// [MOD] UI側が求める既定値（autoPost は boolean に統一）
const DEFAULTS = {
  discordWebhook: "",
  errorDiscordWebhook: "",
  openaiApiKey: "",
  selectedModel: "gpt-5-mini",
  masterPrompt: "",
  replyPrompt: "",
  autoPost: false as boolean,
  doublePostDelay: "5",
  doublePostDelete: false,
  doublePostDeleteDelay: "60",
  parentDelete: false,
  enableAppColumn: true,
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
        // [ADD] 初回ユーザーは既定値で返す（DB作成はしない）
        return res.status(200).json({ settings: { ...DEFAULTS } });
      }

      // [MOD] BOOL 前提で読み出し。旧キーは参照のみ（自己修復は行わない）
      const list = (it.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean);
      const errList = (it.errorDiscordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean);
      const discordWebhook = it.discordWebhook?.S || list[0] || "";
      const errorDiscordWebhook = it.errorDiscordWebhook?.S || errList[0] || "";
      const openaiApiKey = it.openaiApiKey?.S || it.openAiApiKey?.S || "";
      const rawModel = it.selectedModel?.S || it.modelDefault?.S || DEFAULTS.selectedModel;
      const allow = new Set([
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-4o-mini",
        "o4-mini",
        "gpt-4.1",
        "gpt-4.1-mini",
      ]);
      const selectedModel = allow.has(rawModel) ? rawModel : DEFAULTS.selectedModel;

      // [MOD] autoPost は BOOL のみ採用（S/N は無視＝false扱い）。自己修復はしない。
      const autoPost = it.autoPost?.BOOL === true;

      const settings = {
        discordWebhook,
        errorDiscordWebhook,
        openaiApiKey,
        selectedModel,
        masterPrompt: it.masterPrompt?.S || "",
        replyPrompt: it.replyPrompt?.S || "",
        autoPost,
        doublePostDelay: it.doublePostDelay?.N ? String(it.doublePostDelay.N) : "5",
        doublePostDelete: it.doublePostDelete?.BOOL === true,
        doublePostDeleteDelay: it.doublePostDeleteDelay?.N ? String(it.doublePostDeleteDelay.N) : "60",
        parentDelete: it.parentDelete?.BOOL === true,
        enableAppColumn: it.enableAppColumn?.BOOL === true,
      };

      return res.status(200).json({ settings });
    }

    // [MOD] 保存メソッドを PATCH に統一（PUT は廃止）
    if (req.method === "PATCH") {
      // [MOD] UIからの値（boolean/number/string）を受ける。互換キーは受理するが保存は新キーのみ。
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const {
        discordWebhook,
        errorDiscordWebhook,
        openaiApiKey,
        selectedModel,
        masterPrompt,
        replyPrompt,
        autoPost,
        doublePostDelay,
        doublePostDelete,
        doublePostDeleteDelay,
        parentDelete,
        enableAppColumn,
      } = body;

      // [ADD] 型ガード（最低限）
      const has = (v: any) => typeof v !== "undefined";
      if (has(autoPost) && typeof autoPost !== "boolean") {
        return res.status(400).json({ error: "autoPost must be boolean" });
      }

      const names: Record<string, string> = {};
      const values: Record<string, any> = { ":u": { N: String(Math.floor(Date.now() / 1000)) } };
      const sets: string[] = [];

      if (has(discordWebhook)) {
        names["#dw"] = "discordWebhook";
        values[":dw"] = { S: String(discordWebhook || "") };
        sets.push("#dw = :dw");
      }
      if (has(errorDiscordWebhook)) {
        names["#edw"] = "errorDiscordWebhook";
        values[":edw"] = { S: String(errorDiscordWebhook || "") };
        sets.push("#edw = :edw");
      }
      if (has(openaiApiKey)) {
        names["#oak"] = "openaiApiKey";
        values[":oak"] = { S: String(openaiApiKey || "") };
        sets.push("#oak = :oak");
      }
      if (has(selectedModel)) {
        names["#sm"] = "selectedModel";
        values[":sm"] = { S: String(selectedModel || DEFAULTS.selectedModel) };
        sets.push("#sm = :sm");
      }
      if (has(masterPrompt)) {
        names["#mp"] = "masterPrompt";
        values[":mp"] = { S: String(masterPrompt || "") };
        sets.push("#mp = :mp");
      }
      if (has(replyPrompt)) {
        names["#rp"] = "replyPrompt";
        values[":rp"] = { S: String(replyPrompt || "") };
        sets.push("#rp = :rp");
      }
      if (has(autoPost)) {
        names["#ap"] = "autoPost";
        values[":ap"] = { BOOL: !!autoPost }; // [MOD] 常に BOOL で保存
        sets.push("#ap = :ap");
      }
      if (has(doublePostDelay)) {
        const n = Math.max(0, Number(doublePostDelay) || 0);
        names["#dpd"] = "doublePostDelay";
        values[":dpd"] = { N: String(n) };
        sets.push("#dpd = :dpd");
      }
      if (has(doublePostDelete)) {
        names["#dpdel"] = "doublePostDelete";
        values[":dpdel"] = { BOOL: !!doublePostDelete };
        sets.push("#dpdel = :dpdel");
      }
      if (has(doublePostDeleteDelay)) {
        const n = Math.max(0, Number(doublePostDeleteDelay) || 0);
        names["#dpdelD"] = "doublePostDeleteDelay";
        values[":dpdelD"] = { N: String(n) };
        sets.push("#dpdelD = :dpdelD");
      }
      if (has(parentDelete)) {
        names["#pdel"] = "parentDelete";
        values[":pdel"] = { BOOL: !!parentDelete };
        sets.push("#pdel = :pdel");
      }
      if (has(enableAppColumn)) {
        names["#eapp"] = "enableAppColumn";
        values[":eapp"] = { BOOL: !!enableAppColumn };
        sets.push("#eapp = :eapp");
      }

      if (!sets.length) return res.status(400).json({ error: "no_fields" });
      sets.push("updatedAt = :u");

      // [ADD] レコードが無い場合に備え、空レコードを先に作成（既存なら無視）
      await ddb
        .send(
          new PutItemCommand({
            TableName: TBL_SETTINGS,
            Item: { ...Key },
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          })
        )
        .catch(() => { /* 既存なら無視 */ });

      await ddb.send(
        new UpdateItemCommand({
          TableName: TBL_SETTINGS,
          Key,
          UpdateExpression: "SET " + sets.join(", "),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "NONE",
        })
      );

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "PATCH"]); // [MOD]
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
