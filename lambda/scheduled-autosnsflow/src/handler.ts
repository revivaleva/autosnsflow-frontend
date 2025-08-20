// /lambda/scheduled-autosnsflow/src/handler.ts
// 既存ロジックの最小動作：Threadsアカウント一覧をDiscordへ通知
import { fetchDiscordWebhooks } from "@autosnsflow/backend-core";
import { fetchThreadsAccounts } from "@autosnsflow/backend-core";
import { postDiscord } from "@autosnsflow/backend-core";

type EventLike = { userId?: string };

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
const MASTER_DISCORD_WEBHOOK = process.env.MASTER_DISCORD_WEBHOOK || "";

export const handler = async (event: EventLike = {}) => {
  const userId = event.userId || DEFAULT_USER_ID;

  const userHooks = await fetchDiscordWebhooks(userId);
  const accounts = await fetchThreadsAccounts(userId);

  const now = new Date().toISOString();
  const header = `**[scheduled-autosnsflow] Threadsアカウント一覧**\nユーザーID: ${userId}\n件数: ${accounts.length}\n時刻: ${now}`;
  const lines = accounts.map((a, i) => `- ${i + 1}. ${a.displayName || "(no name)"} \`id:${a.accountId}\``);
  const content = [header, ...lines].join("\n");

  await postDiscord(userHooks, content);
  if (MASTER_DISCORD_WEBHOOK) await postDiscord([MASTER_DISCORD_WEBHOOK], content);

  console.log("通知完了", { userId, count: accounts.length });
  return { statusCode: 200, body: JSON.stringify({ userId, count: accounts.length }) };
};
