// /lambda/scheduled-autosnsflow/src/handler.ts
// 定期実行で予約投稿の作成・実投稿・返信処理・2段階投稿を行い、必要な通知と計測を行う。
// 本実装は Threads のみを対象とする（X/Twitter は扱わない）。
// [UPDATE] 2025-01-17: リプライデバッグ機能とグローバル認証保護機能を統合
// [DEPLOY] 2025-01-24: GitHub Actions自動デプロイテスト実行
// [NO-OP] build trigger

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-unused-vars, no-console */
// keep types but avoid disabling TypeScript globally; remove @ts-nocheck

// Removed unused backend-core import; keep SDK calls local to this lambda
import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  ScanCommand,
  DescribeTableCommand,
  BatchWriteItemCommand,
  DeleteItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
// @ts-expect-error: path aliases resolved at build time
import config from '@/lib/config';
// @ts-expect-error: path aliases resolved at build time
import { postToThreads as sharedPostToThreads, postQuoteToThreads as sharedPostQuoteToThreads } from '@/lib/threads';
import crypto from "crypto";
// @ts-expect-error: path aliases resolved at build time
import { deleteThreadsPostWithToken } from '@/lib/threads-delete';
import { unmarshall } from "@aws-sdk/util-dynamodb";

// Disable test-only global output collector (no-op stub) to avoid test-only side-effects.
try { (global as any).__TEST_OUTPUT__ = { push: () => {} }; } catch (_) {}

/// === テーブル名 ===
const TBL_SETTINGS   = "UserSettings";
// Note: TBL_THREADS_ACCOUNTS is resolved from env by default; AppConfig can override at runtime where config.loadConfig() is used.
const TBL_THREADS    = "ThreadsAccounts";
const TBL_THREADS_ACCOUNTS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const TBL_SCHEDULED  = "ScheduledPosts";
const TBL_REPLIES    = "Replies";
const TBL_GROUPS     = "AutoPostGroups";
const TBL_LOGS       = "ExecutionLogs";
const TBL_USAGE      = "UsageCounters";
const TBL_POST_POOL  = process.env.TBL_POST_POOL || "PostPool";

// USER_ID removed; use DEFAULT_USER_ID or explicit parameter

const region = process.env.AWS_REGION || "ap-northeast-1";
const ddb = new DynamoDBClient({ region });

// Feature flags / env toggles
const DISABLE_QUOTE_PROCESSING = !!process.env.DISABLE_QUOTE_PROCESSING;

// Wrap ddb.send to automatically alias reserved keyword 'status' in ProjectionExpression
// This prevents ValidationException when 'status' is used as an attribute name in projections
{
  const origSend = ddb.send.bind(ddb);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ddb as any).send = async function(cmd: any) {
    try {
      const input = cmd?.input || cmd;
      if (input && typeof input.ProjectionExpression === 'string' && /\bstatus\b/.test(input.ProjectionExpression)) {
        // Ensure ExpressionAttributeNames exists and maps '#st' to 'status'
        input.ExpressionAttributeNames = Object.assign({}, input.ExpressionAttributeNames || {}, { '#st': 'status' });
        input.ProjectionExpression = input.ProjectionExpression.replace(/\bstatus\b/g, '#st');
      }
    } catch (_) {}
    return origSend(cmd);
  };
}

// Helpers to safely read DynamoDB attribute shapes
const getS = (a: any) => (a && typeof a.S !== 'undefined') ? a.S : undefined;
const getN = (a: any) => (a && typeof a.N !== 'undefined') ? a.N : undefined;
// Remove undefined values from DynamoDB Item before PutItemCommand
const sanitizeItem = (it: any) => {
  const out: any = {};
  for (const k of Object.keys(it || {})) {
    const v = it[k];
    if (typeof v === 'undefined') continue;
    out[k] = v;
  }
  return out;
};

// Claim a pool item for a user and poolType. Returns { poolId, content, images } or null.
async function claimPoolItem(userId: string, poolType: string) {
  try {
    const out = await ddb.send(new QueryCommand({
      TableName: TBL_POST_POOL,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: "POOL#" },
      },
      Limit: 200,
    }));
    const items = (out as any).Items || [];
    const candidates = items.filter((it: any) => (getS(it.type) || '') === String(poolType));
    if (!candidates || candidates.length === 0) return null;
    // shuffle
    for (const it of candidates.sort(() => 0.5 - Math.random())) {
      const poolId = getS(it.poolId) || (getS(it.SK) || "").replace(/^POOL#/, "");
      if (!poolId) continue;
      try {
        await ddb.send(new DeleteItemCommand({
          TableName: TBL_POST_POOL,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: `POOL#${poolId}` } },
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
        }));
        return {
          poolId,
          content: getS(it.content) || "",
          images: (getS(it.images) ? JSON.parse(getS(it.images)) : []),
        };
      } catch (e) {
        // concurrent claim or delete failed - try next
        continue;
      }
    }
    return null;
  } catch (e) {
    try { await putLog({ userId, type: "post-pool", accountId: "", status: "error", message: "claim_failed", detail: { error: String(e) } }); } catch(_) {}
    return null;
  }
}

// Increment account failure count atomically
async function incrementAccountFailure(userId: string, accountId: string) {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_THREADS_ACCOUNTS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
      UpdateExpression: "SET failureCount = if_not_exists(failureCount, :zero) + :inc",
      ExpressionAttributeValues: { ":zero": { N: "0" }, ":inc": { N: "1" } },
    }));
  } catch (e) {
    try { await putLog({ userId, type: "auto-post", accountId, status: "error", message: "increment_failure_failed", detail: { error: String(e) } }); } catch(_) {}
  }
}

// Normalize DynamoDB epoch value to seconds.
// Handles values stored in seconds or milliseconds.
function normalizeEpochSec(raw: any): number {
  if (raw === null || typeof raw === 'undefined') return 0;
  const v = Number(raw);
  if (!isFinite(v)) return 0;
  // Heuristic: if value looks like milliseconds (> 1e12), convert to seconds
  if (v > 1e12) return Math.floor(v / 1000);
  return Math.floor(v);
}

// Helper: determine execution logs prune days (priority: EXECUTION_LOGS_PRUNE_DELAY_DAYS -> RETENTION_DAYS_LOGS+1 -> RETENTION_DAYS+1)
async function resolveExecutionPruneDays(): Promise<number> {
  try { await config.loadConfig(); } catch(_) {}
  const execVal = Number(config.getConfigValue('EXECUTION_LOGS_PRUNE_DELAY_DAYS') || process.env.EXECUTION_LOGS_PRUNE_DELAY_DAYS || 0) || 0;
  if (execVal > 0) return execVal;
  const rLogs = Number(config.getConfigValue('RETENTION_DAYS_LOGS') || process.env.RETENTION_DAYS_LOGS || '0') || 0;
  if (rLogs > 0) return rLogs + 1;
  const base = Number(config.getConfigValue('RETENTION_DAYS') || process.env.RETENTION_DAYS || '7') || 7;
  return base + 1;
}

const isValidUrl = (s: any) => {
  try {
    if (!s || typeof s !== 'string') return false;
    // allow only http(s)
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
};

/// ========== 共通ユーティリティ ==========// trigger: lambda build noop change - ensure CI picks up

const TZ = "Asia/Tokyo";
const nowSec = () => Math.floor(Date.now() / 1000);
const toEpochSec = (d: any) => Math.floor(d.getTime() / 1000);

// JST(UTC+9)の固定オフセット（DSTなし）
const JST_OFFSET_MIN = 9 * 60;
const MS_PER_MIN = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 与えた時刻(ms)の「JSTの一日の開始/終了」のUTCエポックを返す
const epochStartOfJstDayMs = (ms: any) => {
  const o = JST_OFFSET_MIN * MS_PER_MIN;
  return Math.floor((ms + o) / MS_PER_DAY) * MS_PER_DAY - o;
};
const epochEndOfJstDayMs = (ms: any) => epochStartOfJstDayMs(ms) + MS_PER_DAY - 1;

// 現在時刻（Date）
const jstNow = () => new Date(Date.now());

// JSTの0:00/23:59:59.999
const startOfDayJst = (d: any) => new Date(epochStartOfJstDayMs(d.getTime()));
const endOfDayJst   = (d: any) => new Date(epochEndOfJstDayMs(d.getTime()));

// Helpers to unify JST midnight/date handling (UTC instant representing JST 00:00)
function getJstMidnightUtcDate(anyDate: Date = new Date()): Date {
  const jstMs = anyDate.getTime() + 9 * 3600 * 1000;
  const jst = new Date(jstMs);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  const utcMsForJstMidnight = Date.UTC(y, m, d, 0, 0, 0) - (9 * 3600 * 1000);
  return new Date(utcMsForJstMidnight);
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

function yyyymmddJstFromDate(anyDate: Date = new Date()) {
  const jstMs = anyDate.getTime() + 9 * 3600 * 1000;
  const jst = new Date(jstMs);
  return `${jst.getUTCFullYear()}${pad2(jst.getUTCMonth() + 1)}${pad2(jst.getUTCDate())}`;
}

function getJstDayInfos(referenceMs: number = Date.now()) {
  const ref = new Date(referenceMs);
  const todayMid = getJstMidnightUtcDate(ref);
  const tomorrowMid = getJstMidnightUtcDate(new Date(referenceMs + MS_PER_DAY));
  return [
    { date: todayMid, ymd: yyyymmddJstFromDate(todayMid) },
    { date: tomorrowMid, ymd: yyyymmddJstFromDate(tomorrowMid) },
  ];
}

const TABLE  = process.env.SCHEDULED_POSTS_TABLE || "ScheduledPosts";

/// ========== GSI名 ==========
// legacy / generic: GSI1 mapped to accountId+scheduledAt in some environments
const GSI_SCH_BY_ACC_TIME = "GSI1"; // ScheduledPosts: accountId, scheduledAt (legacy)
// New, purpose-specific GSIs (infrastructure pending-gsis.yml)
const GSI_NEEDS_BY_NEXTGEN = "NeedsContentByNextGen"; // ScheduledPosts: needsContentAccount, nextGenerateAt
const GSI_PENDING_BY_ACC_TIME = "PendingByAccTime";   // ScheduledPosts: pendingForAutoPostAccount, scheduledAt
const GSI_POS_BY_ACC_TIME = "GSI2"; // ScheduledPosts: accountId, postedAt
const GSI_REPLIES_BY_ACC  = "GSI1"; // Replies: accountId, createdAt

/// ========== OpenAI 既定値 & プロンプト生成 ==========
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_OPENAI_TEMP = 0.7;
const DEFAULT_OPENAI_MAXTOKENS = 300;

function isGsiMissing(err: any) {
  const msg = String(err?.message || err || "");
  return err?.name === "ValidationException" && /specified index/i.test(msg);
}

function buildMasterPrompt(theme: any, displayName: any) {
  return `以下のテーマでSNS投稿文（140字前後・絵文字は控えめ・ハッシュタグなし）を1本、日本語で作成してください。
- テーマ: ${theme}
- 語り口: 読み手に寄り添う自然な一人称
- 実名や固有名詞は出さない
- 改行は2回まで
（アカウント名: ${displayName || "N/A"}）`;
}

// 返信プロンプトを構築する関数
function buildReplyPrompt(incomingReply: string, originalPost: string, settings: any, acct: any) {
  let prompt = "";
  
  if (settings.masterPrompt?.trim()) {
    // ユーザー設定のマスタープロンプトがある場合
    prompt = `【運用方針】\n${settings.masterPrompt}\n\n`;
  }
  
  prompt += `【元の投稿】\n${originalPost}\n\n`;
  prompt += `【受信したリプライ】\n${incomingReply}\n\n`;
  prompt += `【指示】\n上記のリプライに対して、運用方針に従って自然な返信を140文字以内で作成してください。\n`;
  prompt += `- 丁寧で親しみやすい口調\n`;
  prompt += `- 相手のリプライに共感を示す\n`;
  prompt += `- ハッシュタグは使用しない\n`;
  prompt += `- 返信内容のみを出力（余計な説明は不要）`;
  
  return prompt;
}

function sanitizeModelName(model: any): string {
  // Allow both inference (gpt-5 series) and non-inference (gpt-4o) families
  const allow = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"];
  const m = String(model || "");
  return allow.includes(m) ? m : "gpt-5-mini";
}

async function callOpenAIText(params: any) {
  // Try to use shared helper first
  try {
    const mod = await import('./lib/openai');
    if (mod && typeof mod.callOpenAIText === 'function') {
      return await mod.callOpenAIText({ apiKey: params.apiKey, model: params.model, systemPrompt: params.systemPrompt || "", userPrompt: params.prompt || params.userPrompt || "", temperature: params.temperature, max_tokens: params.max_tokens });
    }
  } catch (e) {
    // ignore and fallback to local implementation
  }

  // Local fallback implementation
  const m = sanitizeModelName(params.model);
  const isInference = String(m).startsWith("gpt-5");
  const buildBody = (mdl: string, opts: any = {}) => {
    const base: any = {
      model: mdl,
      messages: [{ role: "system", content: params.systemPrompt || "" }, { role: "user", content: params.prompt || params.userPrompt || "" }],
      temperature: isInference ? 1 : (typeof params.temperature === "number" ? params.temperature : DEFAULT_OPENAI_TEMP),
    };
    if (isInference) base.max_completion_tokens = opts.maxOut ?? Math.max(params.max_tokens || DEFAULT_OPENAI_MAXTOKENS, 1024);
    else base.max_tokens = opts.maxOut ?? (params.max_tokens || DEFAULT_OPENAI_MAXTOKENS);
    return JSON.stringify(base);
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
    body: buildBody(m),
  });
  const raw = await resp.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${raw}`);
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  return { text, raw: data };
}

/// ========== Discord ==========
// Discord Webhook送信の独自実装
async function postDiscord(urls: string[], content: string) {
  if (!urls || urls.length === 0) {
    console.info("[info] Discord webhook URLが設定されていないため送信をスキップ");
    return;
  }

  const promises = urls.map(async (url) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: content,
          username: "AutoSNSFlow",
          avatar_url: "",
        }),
      });

      if (!response.ok) {
        throw new Error(`Discord webhook error: ${response.status} ${response.statusText}`);
      }

      console.info(`[info] Discord webhook送信成功: ${url}`);
      return { success: true, url };
    } catch (error) {
      console.error(`[error] Discord webhook送信失敗: ${url}`, error);
      return { success: false, url, error: String(error) };
    }
  });

  const results = await Promise.allSettled(promises);
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const totalCount = urls.length;

  console.info(`[info] Discord webhook送信完了: ${successCount}/${totalCount} 成功`);
}

async function getDiscordWebhooks(userId = DEFAULT_USER_ID) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      ProjectionExpression: "discordWebhook"
    })
  );
  const single = getS(out.Item?.discordWebhook);
  const urls = single && isValidUrl(single) ? [single] : [];
  return urls;
}

async function postDiscordLog({ userId = DEFAULT_USER_ID, content, isError = false }: any) {
  try {
    const sets = await getDiscordWebhookSets(userId);
    const urls = isError ? (sets.error && sets.error.length ? sets.error : sets.normal) : sets.normal;
    if (!urls || urls.length === 0) {
      console.info("[info] Discord webhook URLが設定されていないため送信をスキップ");
      return;
    }
    await postDiscord(urls, content);
  } catch (e) {
    console.warn("[warn] postDiscordLog failed:", String(e));
  }
}

async function getDiscordWebhookSets(userId = DEFAULT_USER_ID) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      ProjectionExpression: "discordWebhook, errorDiscordWebhook",
    })
  );
  const nSingle = getS(out.Item?.discordWebhook);
  const eSingle = getS(out.Item?.errorDiscordWebhook);
  const normal = nSingle && isValidUrl(nSingle) ? [nSingle] : [];
  const error = eSingle && isValidUrl(eSingle) ? [eSingle] : [];
  return { normal, error };
}

/// ========== 設定・ユーザー ==========
async function getActiveUserIds() {
  let lastKey: any; const ids: string[] = [];
  do {
    const res: any = await ddb.send(
      new ScanCommand({
        TableName: TBL_SETTINGS,
        ProjectionExpression: "PK, SK, autoPost, masterOverride, autoPostAdminStop",
        FilterExpression:
          "#sk = :sk AND (" +
            "(attribute_type(autoPost, :boolType) AND autoPost = :apB) OR " +
            "(attribute_type(autoPost, :stringType) AND autoPost = :apS)" +
          ") AND (attribute_not_exists(masterOverride) OR masterOverride = :mo)" +
          " AND (attribute_not_exists(autoPostAdminStop) OR autoPostAdminStop = :f)",
        ExpressionAttributeNames: { "#sk": "SK" },
        ExpressionAttributeValues: {
          ":sk":        { S: "SETTINGS" },
          ":apS":       { S: "active" },
          ":apB":       { BOOL: true },
          ":mo":        { S: "none" },
          ":f":         { BOOL: false },
          ":boolType":  { S: "BOOL" },
          ":stringType": { S: "S" },
        },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const it of (res.Items || [])) {
      const pk = it.PK?.S || "";
      if (pk.startsWith("USER#")) ids.push(pk.replace("USER#", ""));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return ids;
}

async function getUserSettings(userId = DEFAULT_USER_ID) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      ProjectionExpression:
        "doublePostDelay, autoPost, dailyOpenAiLimit, defaultOpenAiCost, openaiApiKey, selectedModel, masterPrompt, quotePrompt, openAiTemperature, openAiMaxTokens, autoPostAdminStop, doublePostDelete, doublePostDeleteDelay, parentDelete, enableX",
    })
  );
  const delay = Number(out.Item?.doublePostDelay?.N || "0");

  const ap = out.Item?.autoPost;
  let autoPost = "active";
  if (ap?.BOOL === true) autoPost = "active";
  else if (ap?.BOOL === false) autoPost = "inactive";
  else autoPost = ap?.S || "active";

  const adminStop = out.Item?.autoPostAdminStop?.BOOL === true;
  if (adminStop) autoPost = "inactive";

  const dailyOpenAiLimit = Number(out.Item?.dailyOpenAiLimit?.N || "200");
  const defaultOpenAiCost = Number(out.Item?.defaultOpenAiCost?.N || "1");

  const openaiApiKey = out.Item?.openaiApiKey?.S || "";
  const rawModel = out.Item?.selectedModel?.S || DEFAULT_OPENAI_MODEL;
  const model = sanitizeModelName(rawModel);
  const masterPrompt = out.Item?.masterPrompt?.S || "";
  const quotePrompt = out.Item?.quotePrompt?.S || "";
  const openAiTemperature = Number(out.Item?.openAiTemperature?.N || DEFAULT_OPENAI_TEMP);
  const openAiMaxTokens = Number(out.Item?.openAiMaxTokens?.N || DEFAULT_OPENAI_MAXTOKENS);

  return {
    doublePostDelayMinutes: delay,
    autoPost,
    dailyOpenAiLimit,
    defaultOpenAiCost,
    openaiApiKey,
    model,
    masterPrompt,
    quotePrompt,
    openAiTemperature,
    openAiMaxTokens,
    enableX: (out.Item?.enableX?.BOOL === true) || (String(out.Item?.enableX?.S || '').toLowerCase() === 'true'),
    doublePostDelete: out.Item?.doublePostDelete?.BOOL === true,
    doublePostDeleteDelayMinutes: Number(out.Item?.doublePostDeleteDelay?.N || "60"),
    parentDelete: out.Item?.parentDelete?.BOOL === true,
  };
}

/// ========== OpenAI使用制限（1日200回相当。文章生成は1カウント） ==========
async function getOpenAiLimitForUser(userId = DEFAULT_USER_ID) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      ProjectionExpression: "dailyOpenAiLimit, defaultOpenAiCost",
    })
  );
  const limit = Number(out.Item?.dailyOpenAiLimit?.N || "200");
  const unit = Number(out.Item?.defaultOpenAiCost?.N || "1");
  return { limit, unit };
}

async function reserveOpenAiCredits(userId = DEFAULT_USER_ID, cost = 1) {
  const day = yyyymmddJst();
  const pk = { S: `USER#${userId}` };
  const sk = { S: `OPENAI#${day}` };

  const { limit, unit } = await getOpenAiLimitForUser(userId);
  const use = Math.max(1, cost || unit || 1);

  // 無制限（limit=0）のときはカウントだけ加算して即OK
  if (limit === 0) {
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_USAGE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "ADD #cnt :u SET updatedAt = :ts",
      ExpressionAttributeNames: { "#cnt": "count" },
      ExpressionAttributeValues: { ":u": { N: String(use) }, ":ts": { N: String(nowSec()) } },
    }));
    return { ok: true, remaining: Infinity };
  }

  try {
    // ConditionExpression に算術や if_not_exists を入れない
    // 1回の増分(use)が 1 を想定: 事前の count < limit なら加算しても上限は超えない
    const out = await ddb.send(new UpdateItemCommand({
      TableName: TBL_USAGE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "ADD #cnt :u SET #lim = if_not_exists(#lim, :lim), updatedAt = :ts",
      ConditionExpression: "attribute_not_exists(#cnt) OR #cnt < #lim",
      ExpressionAttributeNames: { "#cnt": "count", "#lim": "limit" },
      ExpressionAttributeValues: {
        ":u":   { N: String(use) },
        ":lim": { N: String(limit) },
        ":ts":  { N: String(nowSec()) },
      },
      ReturnValues: "ALL_NEW",
    }));

    const newCount = Number(out.Attributes?.count?.N || "0");
    const lim      = Number(out.Attributes?.limit?.N || String(limit));
    return { ok: true, remaining: Math.max(0, lim - newCount) };

  } catch (e) {
    // 条件不成立（上限到達）
    const error = e as Error;
    if (error?.name === "ConditionalCheckFailedException") {
      return { ok: false, remaining: 0 };
    }
    // それ以外は上位に投げる（必要なら putLog してもOK）
    throw e;
  }
}

/// ========== アカウント・グループ ==========
async function getThreadsAccounts(userId = DEFAULT_USER_ID) {
  let lastKey: any; let items: any[] = [];
  do {
    const res: any = await ddb.send(
      new QueryCommand({
        TableName: TBL_THREADS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "ACCOUNT#" },
        },
        // Include oauthAccessToken in projection and prefer it when mapping below.
        // Also include quote-related fields so hourly job can create quote reservations
        ProjectionExpression:
          "SK, displayName, autoPost, autoReply, secondStageContent, rateLimitUntil, autoGenerate, autoPostGroupId, #st, platform, accessToken, oauthAccessToken, providerUserId, monitoredAccountId, autoQuote, quoteTimeStart, quoteTimeEnd",
        ExpressionAttributeNames: { "#st": "status" },
        ExclusiveStartKey: lastKey,
      })
    );
    items = items.concat(res.Items || []);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return items.map((i) => ({
    accountId: (i.SK?.S || "").replace("ACCOUNT#", ""),
    displayName: i.displayName?.S || "",
    autoPost: i.autoPost?.BOOL === true,
    autoReply: i.autoReply?.BOOL === true,
    secondStageContent: i.secondStageContent?.S || "",
    rateLimitUntil: Number(i.rateLimitUntil?.N || "0"),
    autoGenerate: i.autoGenerate?.BOOL === true,
    autoPostGroupId: i.autoPostGroupId?.S || "",
    status: i.status?.S || "active",
    platform: i.platform?.S || "threads",
    // Prefer oauthAccessToken when present, else fall back to accessToken
    accessToken: (i.oauthAccessToken?.S && String(i.oauthAccessToken.S).trim()) ? i.oauthAccessToken.S : (i.accessToken?.S || ""),
    oauthAccessToken: i.oauthAccessToken?.S || "",
    providerUserId: i.providerUserId?.S || "",
    // quote feature fields
    monitoredAccountId: i.monitoredAccountId?.S || "",
    autoQuote: i.autoQuote?.BOOL === true,
    quoteTimeStart: i.quoteTimeStart?.S || "",
    quoteTimeEnd: i.quoteTimeEnd?.S || "",
  }));
}

// X アカウント取得（簡易版）
async function getXAccounts(userId = DEFAULT_USER_ID) {
  const TBL_X = process.env.TBL_X_ACCOUNTS || 'XAccounts';
  let lastKey: any; let items: any[] = [];
  do {
    const res: any = await ddb.send(new QueryCommand({
      TableName: TBL_X,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } },
      ProjectionExpression: 'SK, accountId, username, autoPostEnabled, oauthAccessToken, accessToken, #st, createdAt, updatedAt, #tp',
      ExpressionAttributeNames: { '#st': 'authState', '#tp': 'type' },
      ExclusiveStartKey: lastKey,
    }));
    items = items.concat(res.Items || []);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return items.map((i: any) => ({
    accountId: (i.SK?.S || '').replace(/^ACCOUNT#/, ''),
    username: i.username?.S || '',
    autoPostEnabled: i.autoPostEnabled?.BOOL === true,
    oauthAccessToken: i.oauthAccessToken?.S || '',
    accessToken: i.accessToken?.S || '',
    authState: i.authState?.S || '',
    createdAt: i.createdAt?.N ? Number(i.createdAt.N) : 0,
    updatedAt: i.updatedAt?.N ? Number(i.updatedAt.N) : 0,
    // X account type (must be present for X pool operations). Do NOT fallback to 'general' here.
    type: i.type?.S,
  }));
}

async function getAutoPostGroup(userId: any, groupId: any) {
  if (!groupId) return null;
  const gid = groupId.startsWith("GROUP#") ? groupId.slice(6) : groupId;
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_GROUPS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `GROUP#${gid}` } },
      ProjectionExpression: "groupName, theme1, theme2, theme3, time1, time2, time3",
    })
  );
  if (!out.Item) return null;
  return {
    groupName: out.Item.groupName?.S || "",
    theme1: out.Item.theme1?.S || "",
    theme2: out.Item.theme2?.S || "",
    theme3: out.Item.theme3?.S || "",
    time1: out.Item.time1?.S || "",
    time2: out.Item.time2?.S || "",
    time3: out.Item.time3?.S || "",
  };
}

async function getAutoPostGroupItems(userId: any, groupKey: any) {
  if (!groupKey) return [] as any[];
  const out = await ddb.send(new QueryCommand({
    TableName: TBL_GROUPS,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
    ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: `GROUPITEM#${groupKey}#` } },
    ProjectionExpression: "SK, #od, timeRange, theme, enabled",
    ExpressionAttributeNames: { "#od": "order" },
    ScanIndexForward: true,
    Limit: 100,
  }));
  const items = (out.Items || []).map((i: any) => ({
    slotId: (i.SK?.S || '').split('#').pop() || '',
    order: i.order?.N ? Number(i.order.N) : 0,
    timeRange: i.timeRange?.S || '',
    theme: i.theme?.S || '',
    enabled: i.enabled?.BOOL === true,
  })).filter(x => x.enabled !== false).sort((a, b) => a.order - b.order);
  return items;
}

/// ========== 予約投稿（毎時の"翌日分作成"） ==========
async function isPostedToday(userId: any, acct: any, groupTypeStr: any) {
  const t0 = toEpochSec(startOfDayJst(jstNow()));
  const t1 = toEpochSec(endOfDayJst(jstNow()));
  const res = await ddb.send(
    new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: "SCHEDULEDPOST#" },
        ":acc": { S: acct.accountId },
        ":grp": { S: groupTypeStr },
        ":st": { S: "posted" },
        ":t0": { N: String(t0) },
        ":t1": { N: String(t1) },
      },
      FilterExpression:
        "accountId = :acc AND autoPostGroupId = :grp AND #st = :st AND postedAt BETWEEN :t0 AND :t1",
      ExpressionAttributeNames: { "#st": "status" },
      ProjectionExpression: "SK",
    })
  );
  return (res.Items || []).length > 0;
}

async function existsForDate(userId: any, acct: any, groupTypeStr: any, dateJst: any) {
  const t0 = toEpochSec(startOfDayJst(dateJst));
  const t1 = toEpochSec(endOfDayJst(dateJst));
  const res = await ddb.send(
    new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: "SCHEDULEDPOST#" },
        ":acc": { S: acct.accountId },
        ":grp": { S: groupTypeStr },
        ":t0": { N: String(t0) },
        ":t1": { N: String(t1) },
      },
      FilterExpression:
        "accountId = :acc AND autoPostGroupId = :grp AND scheduledAt BETWEEN :t0 AND :t1",
      ProjectionExpression: "SK",
    })
  );
  return (res.Items || []).length > 0;
}

// 未投稿の自動投稿を物理削除する関数
async function deleteUnpostedAutoPosts(userId: any, acct: any, groupTypeStr: any, dateJst: any) {
  const t0 = toEpochSec(startOfDayJst(dateJst));
  const t1 = toEpochSec(endOfDayJst(dateJst));
  
  // 指定日付の未投稿の自動投稿を検索
  const res = await ddb.send(
    new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk": { S: `USER#${userId}` },
        ":pfx": { S: "SCHEDULEDPOST#" },
        ":acc": { S: acct.accountId },
        ":grp": { S: groupTypeStr },
        ":t0": { N: String(t0) },
        ":t1": { N: String(t1) },
        ":st": { S: "scheduled" },
        ":posted": { N: "0" },
      },
      FilterExpression:
        "accountId = :acc AND autoPostGroupId = :grp AND scheduledAt BETWEEN :t0 AND :t1 AND #st = :st AND postedAt = :posted",
      ExpressionAttributeNames: { "#st": "status" },
      ProjectionExpression: "PK, SK",
    })
  );
  
  // 物理削除を実行
  let deletedCount = 0;
  for (const item of (res.Items || [])) {
    try {
      await ddb.send(new DeleteItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: item.PK, SK: item.SK },
      }));
      deletedCount++;
    } catch (e) {
      console.warn(`[warn] 削除失敗: ${item.SK?.S}`, e);
    }
  }
  
  if (deletedCount > 0) {
    await putLog({
      userId, type: "auto-post", accountId: acct.accountId,
      status: "info", message: `未投稿の自動投稿 ${deletedCount} 件を削除しました (${groupTypeStr})`
    });
  }
  
  return deletedCount;
}

async function createScheduledPost(userId: any, { acct, group, type, whenJst, overrideTheme = "", overrideTimeRange = "", secondStageWanted = undefined, scheduledSource = undefined, poolType = undefined }: any, opts: any = {}) {
  const themeStr = (overrideTheme || ((type === 1 ? group.theme1 : type === 2 ? group.theme2 : group.theme3) || ""));
  const groupTypeStr = `${group.groupName}-自動投稿${type}`;
  const timeRange = (overrideTimeRange || (type === 1 ? (group.time1 || "05:00-08:00") : type === 2 ? (group.time2 || "12:00-13:00") : (group.time3 || "20:00-23:00")) || "");
  const id = crypto.randomUUID();
  // determine secondStageWanted boolean: prefer explicit argument, fallback to overrideTheme.object or default false
  const secondStageFlag = typeof secondStageWanted !== 'undefined'
    ? !!secondStageWanted
    : !!(overrideTheme && (typeof overrideTheme === 'object' ? overrideTheme.secondStageWanted : false)) || false;

  const item = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${id}` },
    scheduledPostId: { S: id },
    accountId: { S: acct.accountId },
    accountName: { S: acct.displayName || "" },
    autoPostGroupId: { S: groupTypeStr },
    theme: { S: themeStr },
    content: { S: "" },
    // optional: mark as pool-driven reservation when requested by caller (e.g., pool-based posting)
    ...(scheduledSource ? { type: { S: String(scheduledSource) } } : {}),
    ...(poolType ? { poolType: { S: String(poolType) } } : {}),
    // スパースGSI用の属性（候補のみインデックスされるよう、候補時に文字列で accountId を保存）
    needsContentAccount: { S: acct.accountId },
    // nextGenerateAt を明示的に0にして GSI に入るようにする
    nextGenerateAt: { N: "0" },
    scheduledAt: { N: String(toEpochSec(whenJst)) },
    postedAt: { N: "0" },
    status: { S: "scheduled" },
    createdAt: { N: String(nowSec()) },
    isDeleted: { BOOL: false },
    timeRange: { S: timeRange },
    // スロットに二段階投稿指定があれば予約レコードに保存（呼び出し元で明示可能）
    secondStageWanted: { BOOL: !!secondStageFlag },
    // 削除予約フィールド（Lambda 経由での予約作成時に渡されれば保存する）
    deleteScheduledAt: (typeof overrideTheme === 'object' && overrideTheme?.deleteScheduledAt) ? { N: String(Math.floor(new Date(String(overrideTheme.deleteScheduledAt)).getTime() / 1000)) } : undefined,
    deleteParentAfter: (typeof overrideTheme === 'object' && typeof overrideTheme?.deleteParentAfter !== 'undefined') ? { BOOL: !!overrideTheme.deleteParentAfter } : undefined,
  };
  // If dry-run is requested via opts or global test-capture, do not perform the PutItem.
  const dryRun = !!(opts && opts.dryRun) || !!(global as any).__TEST_CAPTURE__;
  if (dryRun) {
    try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'DRYRUN_CREATE_SCHEDULED_POST', payload: { userId, accountId: acct.accountId, whenJst: whenJst.toISOString(), group: group.groupName, type, poolType } }); } catch(_) {}
    return { id, groupTypeStr, themeStr };
  }
  await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: sanitizeItem(item) }));
  return { id, groupTypeStr, themeStr };
}

// X-specific scheduled post creation wrapper: require acct.type or provided poolType
async function createXScheduledPost(userId: any, xacct: any, whenJst: Date, opts: any = {}) {
  try {
    // Require explicit xacct.type; do not fallback to opts.poolType or 'general'.
    const effectivePoolType = (xacct && xacct.type) ? String(xacct.type) : '';
    if (!effectivePoolType) {
      await putLog({ userId, type: "auto-post-x", accountId: xacct && xacct.accountId, status: "error", message: "createXScheduledPost failed: poolType missing on account" });
      return { created: 0, skipped: true, error: 'poolType_missing' };
    }
    const id = `xsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    const now = `${Math.floor(Date.now() / 1000)}`;
    const scheduledAt = Math.floor(whenJst.getTime() / 1000);
    const timeRange = opts.overrideTimeRange || opts.timeRange || (opts.type === 1 ? (opts.group?.time1 || "") : opts.type === 2 ? (opts.group?.time2 || "") : (opts.group?.time3 || "")) || "";
    if (!timeRange) {
      try { await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "error", message: "createXScheduledPost failed: timeRange required", detail: { poolType: effectivePoolType } }); } catch(_) {}
      return { created: 0, skipped: true, error: 'timeRange_required' };
    }
    const timeRangeNorm = String(timeRange).replace(/[^0-9A-Za-z]/g, '_') || '';
    // Compute YMD using unified JST helper to ensure consistency with dayInfos
    const ymd = yyyymmddJstFromDate(new Date(scheduledAt * 1000));
    const skId = `SCHEDULEDPOST#${xacct.accountId}#${ymd}#${timeRangeNorm}`;
    const item: any = {
      PK: { S: `USER#${userId}` },
      SK: { S: skId },
      scheduledPostId: { S: id },
      accountId: { S: xacct.accountId },
      accountName: { S: xacct.username || xacct.accountId || '' },
      content: { S: '' },
      scheduledAt: { N: String(scheduledAt) },
      postedAt: { N: '0' },
      status: { S: 'scheduled' },
      timeRange: { S: timeRange || '' },
      scheduledSource: { S: 'pool' },
      poolType: { S: String(effectivePoolType) },
      createdAt: { N: now },
      updatedAt: { N: now },
      scheduledDateYmd: { S: ymd },
    };
    try {
      const tbl = process.env.TBL_X_SCHEDULED || 'XScheduledPosts';
      try { console.info('[x-hourly] attempting PutItem', { userId, sk: skId, table: tbl }); } catch(_) {}
      await ddb.send(new PutItemCommand({ TableName: tbl, Item: sanitizeItem(item), ConditionExpression: 'attribute_not_exists(SK)' }));
      await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "ok", message: "x reservation created", detail: { scheduledPostId: id, whenJst: whenJst.toISOString(), poolType: effectivePoolType, sk: skId, table: tbl } });
      return { created: 1, scheduledPostId: id, sk: skId };
    } catch (e:any) {
      try { console.error('[x-hourly] createXScheduledPost failed', String(e)); } catch(_) {}
      // If conditional check failed, fetch existing item to help debugging
      try {
        if (String(e?.name || '').includes('ConditionalCheckFailed') || String(e?.message || '').toLowerCase().includes('conditional')) {
          const tbl = process.env.TBL_X_SCHEDULED || 'XScheduledPosts';
          try {
            const existing = await ddb.send(new GetItemCommand({ TableName: tbl, Key: { PK: { S: `USER#${userId}` }, SK: { S: skId } } }));
            try { console.info('[x-hourly] createXScheduledPost conditional failed - existing item', { userId, sk: skId, existing: existing?.Item ? true : false, item: existing?.Item || null }); } catch(_) {}
          } catch (_) {}
        }
      } catch (_) {}
      return { created: 0, error: String(e?.message || e) };
    }
  } catch (e:any) {
    try { console.error('[x-hourly] createXScheduledPost unexpected', String(e)); } catch(_) {}
    return { created: 0, error: String(e?.message || e) };
  }
}

// Create a quote reservation for an account if opted-in and monitored account has a new post
async function createQuoteReservationForAccount(userId: any, acct: any, opts: any = {}) {
  try {
    if (!acct || !acct.autoQuote) return { created: 0, skipped: true };
    const monitored = acct.monitoredAccountId || "";
    if (!monitored) return { created: 0, skipped: true };

    // time window check (JST)
    try {
      const qs = acct.quoteTimeStart || "";
      const qe = acct.quoteTimeEnd || "";
      if (qs || qe) {
        const now = new Date();
        const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const hhmm = (d: Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const nowHM = hhmm(jst);
        const s = qs || '00:00';
        const e = qe || '24:00';
        const inRange = s <= e ? (nowHM >= s && nowHM <= e) : (nowHM >= s || nowHM <= e);
        if (!inRange) return { created: 0, skipped: true };
      }
    } catch (e) {
      // ignore time parse errors
    }

    // fetch monitored account tokens
    const mon = await ddb.send(new GetItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${monitored}` } }, ProjectionExpression: 'oauthAccessToken, accessToken' }));
    const token = mon.Item?.oauthAccessToken?.S || mon.Item?.accessToken?.S || '';
    if (!token) {
      await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'skip', message: '監視対象のトークンがないためスキップ' });
      return { created: 0, skipped: true };
    }

    // fetch latest post from monitored account
    const url = new URL('https://graph.threads.net/v1.0/me/threads');
    url.searchParams.set('limit', '1');
    url.searchParams.set('fields', 'id,shortcode,timestamp,text');
    url.searchParams.set('access_token', token);
    const r = await fetch(url.toString());
    if (!r.ok) {
      await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'error', message: '監視対象投稿取得失敗', detail: { status: r.status } });
      return { created: 0, skipped: true };
    }
    const j = await r.json().catch(() => ({}));
    const posts = Array.isArray(j?.data) ? j.data : [];
    if (!posts.length) return { created: 0, skipped: true };
    const p = posts[0];
    // canonicalSource: prefer shortcode (string ID) for duplicate checks per policy
    const canonicalSource = String(p.shortcode || p.id || '');
    const sourceShort = String(p.shortcode || '');
    const sourceText = String(p.text || '');
    if (!canonicalSource) return { created: 0, skipped: true };

    // create reservation atomically with a source marker to avoid duplicates under concurrency
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const nowSecVal = Math.floor(Date.now() / 1000);
    const scheduledItem = {
      PK: { S: `USER#${userId}` },
      SK: { S: `SCHEDULEDPOST#${id}` },
      scheduledPostId: { S: id },
      accountId: { S: acct.accountId },
      accountName: { S: acct.displayName || '' },
      content: { S: '' },
      theme: { S: '引用投稿' },
      scheduledAt: { N: String(nowSecVal) },
      postedAt: { N: '0' },
      status: { S: 'pending_quote' },
      needsContentAccount: { S: acct.accountId },
      nextGenerateAt: { N: String(nowSecVal) },
      generateAttempts: { N: '0' },
      isDeleted: { BOOL: false },
      createdAt: { N: String(nowSecVal) },
      pendingForAutoPostAccount: { S: acct.accountId },
      numericPostId: { S: String(p.id || '') },
      sourcePostId: { S: String(p.shortcode || p.id || '') },
      sourcePostShortcode: { S: sourceShort },
      sourcePostText: { S: sourceText },
      type: { S: 'quote' },
    };

    // Simple duplicate check against current scheduled/posts using canonicalSource (shortcode)
    const pkForQuery = `USER#${userId}`;
    const acctForQuery = acct.accountId || '';

    // normalize helper: trim and strip surrounding quotes and invisible whitespace
    const normalizeId = (s: any) => {
      try { return String(s || '').trim().replace(/^"+|"+$/g, '').replace(/[\u00A0\u200B\uFEFF]/g, '').trim(); } catch(e) { return String(s || ''); }
    };
    const canonicalNormalized = normalizeId(canonicalSource);

    // Fast direct check first (exact match)
    const existsQ2 = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      FilterExpression: 'accountId = :acc AND sourcePostId = :sp',
      ExpressionAttributeValues: { ':pk': { S: pkForQuery }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':acc': { S: acctForQuery }, ':sp': { S: canonicalNormalized } },
      Limit: 1,
    }));
    if ((existsQ2 as any).Items && (existsQ2 as any).Items.length > 0) return { created: 0, skipped: true, sourcePostId: canonicalNormalized, queriedPK: pkForQuery, queriedAccountId: acctForQuery, queriedSourcePostId: canonicalNormalized };

    // Fallback: sometimes stored values may contain invisible chars or quotes; fetch recent account items and compare normalized values client-side
    try {
      const fallbackQ = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        ExpressionAttributeValues: { ':pk': { S: pkForQuery }, ':pfx': { S: 'SCHEDULEDPOST#' } },
        ProjectionExpression: 'sourcePostId, accountId, SK, scheduledPostId',
        Limit: 200
      }));
      const items = (fallbackQ as any).Items || [];
      for (const it of items) {
        const storedAcc = it.accountId?.S || '';
        if (storedAcc !== acctForQuery) continue;
        const stored = normalizeId(it.sourcePostId?.S || '');
        if (!stored) continue;
        if (stored === canonicalNormalized) {
          return { created: 0, skipped: true, sourcePostId: canonicalNormalized, queriedPK: pkForQuery, queriedAccountId: acctForQuery, queriedSourcePostId: canonicalNormalized, matchedStoredSK: it.SK?.S || null, matchedStoredScheduledPostId: it.scheduledPostId?.S || null };
        }
      }
    } catch (e) {
      // non-fatal fallback error — proceed to create reservation
      try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'warn', message: 'fallback_duplicate_check_failed', detail: { error: String(e) } }); } catch (_) {}
    }

    // persist scheduled reservation using canonical sourcePostId
    scheduledItem.sourcePostId = { S: canonicalSource };
    try {
      const dryRun = !!(opts && opts.dryRun) || !!(global as any).__TEST_CAPTURE__;
      if (dryRun) {
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'DRYRUN_CREATE_QUOTE_RESERVATION', payload: { userId, accountId: acct.accountId, scheduledPostId: id, sourcePostId: canonicalSource } }); } catch(_) {}
        return { created: 1, skipped: false, sourcePostId: canonicalSource, queriedPK: pkForQuery, queriedAccountId: acctForQuery, queriedSourcePostId: canonicalSource };
      }
      await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: scheduledItem }));
      await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'ok', message: '引用予約を作成', detail: { scheduledPostId: id, sourcePostId: canonicalSource, queriedPK: pkForQuery, queriedAccountId: acctForQuery, queriedSourcePostId: canonicalSource } });
      return { created: 1, skipped: false, sourcePostId: canonicalSource, queriedPK: pkForQuery, queriedAccountId: acctForQuery, queriedSourcePostId: canonicalSource };
    } catch (e: any) {
      console.warn('[warn] createQuoteReservationForAccount failed during PutItem', String(e));
      try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'error', message: '引用予約作成中に例外', detail: { error: String(e) } }); } catch (_) {}
      return { created: 0, skipped: true };
    }
  } catch (e) {
    console.warn('[warn] createQuoteReservationForAccount failed', String(e));
    try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'error', message: '引用予約作成中に例外', detail: { error: String(e) } }); } catch (_) {}
    return { created: 0, skipped: true };
  }
}

async function generateAndAttachContent(userId: any, acct: any, scheduledPostId: any, themeStr: any, settings: any) {
  try {
    // Require AppConfig OPENAI_API_KEY only (no fallbacks to user settings)
    try {
      await config.loadConfig();
    } catch (e) {
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "error", message: "AppConfigの読み込み失敗", detail: { error: String(e) } });
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_FAIL_REASON', payload: { scheduledPostId, reason: 'appconfig_load_failed', error: String(e) } }); } catch(_) {}
      return false;
    }
    const cfgKey = (() => { try { return config.getConfigValue('OPENAI_API_KEY'); } catch (_) { return null; } })();
    if (!cfgKey) {
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "skip", message: "AppConfig に OPENAI_API_KEY が設定されていないため本文生成をスキップ" });
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_FAIL_REASON', payload: { scheduledPostId, reason: 'openai_key_missing' } }); } catch(_) {}
      return false;
    }
    
    // 編集モーダルと共通化したプロンプト構築
    // prompt を下で定義するため、ここでは一旦スキップして後で組み立てる

    // ペルソナ情報を取得（簡易版）
      let personaText = "";
      if (acct.accountId) {
        try {
          const accRes = await ddb.send(new GetItemCommand({
            TableName: TBL_THREADS,
            Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${acct.accountId || ""}` } },
            ProjectionExpression: "personaMode, personaSimple, personaDetail",
          }));
        
          const mode = (accRes.Item?.personaMode?.S || "").toLowerCase();
          const simple = accRes.Item?.personaSimple?.S || "";
          const detail = accRes.Item?.personaDetail?.S || "";
          
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
          console.warn("[warn] ペルソナ取得失敗:", e);
          personaText = "";
        }
      } else {
        console.warn("[warn] accountIdが未設定のためペルソナ取得をスキップ");
      }
      
      // If this scheduled post is a quote, require DB-stored sourcePostText and use it as the single source
      let quoteIntro = "";
      let isQuoteType = false;
      let sourceTextForPrompt = "";
      try {
        const full = await ddb.send(new GetItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
          ProjectionExpression: 'sourcePostText, #t',
          ExpressionAttributeNames: { '#t': 'type' }
        }));
        const st = full.Item?.sourcePostText?.S || '';
        const t = full.Item?.type?.S || '';
      try {
        (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
        (global as any).__TEST_OUTPUT__.push({ tag: 'QUOTE_PROMPT_DEBUG', payload: { scheduledPostId, stPresent: Boolean(st), stSample: String(st).slice(0,600), type: t, themeSample: String(themeStr).slice(0,200) } });
      } catch (_) {}
        if (t === 'quote') {
          isQuoteType = true;
          // enforce presence of sourcePostText
          if (!st || !String(st).trim()) {
            try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, targetId: scheduledPostId, status: 'error', message: '引用元投稿テキストが存在しないため生成を中止' }); } catch (_) {}
            return false; // stop generation
          }
          quoteIntro = `【引用元投稿】\n${st}\n\n`;
          sourceTextForPrompt = st;
        }
        // If not a quote type, prefer themeStr (passed from caller) as the prompt source; fallback to settings.masterPrompt
        if (!isQuoteType) {
          const tstr = String(themeStr || '').trim();
          const fallback = String(settings?.masterPrompt || '').trim();
          sourceTextForPrompt = tstr || fallback || '';
          if (!sourceTextForPrompt) {
            try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, targetId: scheduledPostId, status: 'warn', message: '生成に使用する投稿テーマが空です', detail: { scheduledPostId, themeStr, fallbackPresent: Boolean(fallback) } }); } catch(_) {}
          }
        }
      } catch (e) {
        try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, targetId: scheduledPostId, status: 'error', message: '引用元投稿取得エラー', detail: { error: String(e) } }); } catch (_) {}
        return false;
      }

      // Instructions: choose quote-specific or regular post instruction depending on type
      const defaultQuoteInstruction = `【指示】\n上記の引用元投稿に自然に反応する形式で、共感や肯定、専門性を含んだ引用投稿文を作成してください。200〜400文字以内。ハッシュタグ禁止。改行は最大1回。`;
      const defaultPostInstruction = `【指示】\n以下の投稿テーマに沿って、140字前後で読み手に寄り添う自然な本文を作成してください。絵文字は控えめに、ハッシュタグは使用しないでください。改行は最大1回。`;

      // Decide policy prompt and build prompt blocks after we determined isQuoteType and sourceTextForPrompt
      let policyPrompt = "";
      try {
        if (isQuoteType) {
          // For quote generation prefer quotePrompt from settings or AppConfig
          if (settings && String(settings.quotePrompt || "").trim()) {
            policyPrompt = String(settings.quotePrompt).trim();
          }
          if (!policyPrompt) {
            try { await config.loadConfig(); } catch(_) {}
            policyPrompt = String(config.getConfigValue('QUOTE_PROMPT') || "").trim();
          }
          if (!policyPrompt) policyPrompt = String(settings.masterPrompt || "").trim();
        } else {
          // For normal posts prefer masterPrompt (user-level) or a generic POST_PROMPT from AppConfig
          if (settings && String(settings.masterPrompt || "").trim()) {
            policyPrompt = String(settings.masterPrompt).trim();
          }
          if (!policyPrompt) {
            try { await config.loadConfig(); } catch(_) {}
            policyPrompt = String(config.getConfigValue('POST_PROMPT') || "").trim();
          }
          if (!policyPrompt) policyPrompt = String(settings.masterPrompt || "").trim();
        }
      } catch (_) { policyPrompt = String(settings.masterPrompt || "").trim(); }

      // Build prompt blocks
      const policyBlock = policyPrompt ? `【運用方針】\n${policyPrompt}\n\n` : "";
      const personaBlock = personaText ? `【アカウントのペルソナ】\n${personaText}\n\n` : `【アカウントのペルソナ】\n(未設定)\n\n`;
      const sourceBlock = (isQuoteType && quoteIntro) ? `${quoteIntro}` : `【投稿テーマ】\n${String(sourceTextForPrompt)}\n\n`;

      const instructionBlock = isQuoteType ? defaultQuoteInstruction : defaultPostInstruction;
      const prompt: string = `${policyBlock}${personaBlock}${sourceBlock}${instructionBlock}`.trim();
      try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, targetId: scheduledPostId, status: 'info', message: 'prompt_constructed', detail: { isQuoteType, policyPromptUsed: Boolean(policyPrompt), themeSample: String(sourceTextForPrompt).slice(0,200) } }); } catch(_) {}

    // OpenAI 呼び出しは共通ヘルパーを使い、内部でリトライ／フォールバックする
    let text: any = undefined;
    try {
      // log call metadata (do not log API key)
      // OpenAI call start (minimal logging)
      try { /* debug removed */ } catch (_) {}

      // Prepare OpenAI request payload (mask API key when logging)
      const openAiRequestPayload: any = {
        apiKey: (() => { try { return config.getConfigValue('OPENAI_API_KEY'); } catch (_) { return settings.openaiApiKey || ''; } })(),
        model: settings.model || DEFAULT_OPENAI_MODEL,
        temperature: settings.openAiTemperature ?? DEFAULT_OPENAI_TEMP,
        max_tokens: settings.openAiMaxTokens ?? DEFAULT_OPENAI_MAXTOKENS,
        prompt,
        systemPrompt: "",
      };
      try {
        // Log sanitized request for debugging and attach to test output when running tests
        const sanitized = Object.assign({}, openAiRequestPayload, { apiKey: openAiRequestPayload.apiKey ? '***REDACTED***' : '' });
        try { console.info('[QUOTE OPENAI REQ]', { model: sanitized.model, temperature: sanitized.temperature, max_tokens: sanitized.max_tokens, promptSnippet: String(sanitized.prompt).slice(0,1200) }); } catch (_) {}
        try {
        (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
          // Include the full prompt for test inspection (no API keys)
          (global as any).__TEST_OUTPUT__.push({ tag: 'QUOTE_OPENAI_REQ', payload: { model: sanitized.model, temperature: sanitized.temperature, max_tokens: sanitized.max_tokens, prompt: String(sanitized.prompt) } });
        } catch (_) {}

      // Also emit explicit settings/payload snapshot (masked) so test runs can verify key presence and payload
      try {
        (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
        (global as any).__TEST_OUTPUT__.push({ tag: 'OPENAI_SETTINGS', payload: { settings_openai_present: !!settings.openaiApiKey, settings_openai_mask: settings.openaiApiKey ? ('***' + String(settings.openaiApiKey).slice(-6)) : null, settings_model: settings.model || DEFAULT_OPENAI_MODEL } });
        (global as any).__TEST_OUTPUT__.push({ tag: 'OPENAI_CALL_PAYLOAD', payload: { model: sanitized.model, temperature: sanitized.temperature, max_tokens: sanitized.max_tokens, prompt: String(sanitized.prompt) } });
      } catch (_) {}
      } catch (_) {}

      const openAiRes = await callOpenAIText(openAiRequestPayload);
      text = openAiRes?.text;
      // when running tests, attach the full OpenAI response to test output for inspection
      try {
        (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
        (global as any).__TEST_OUTPUT__.push({ tag: 'QUOTE_OPENAI_RESP', payload: { ok: Boolean(openAiRes), text: openAiRes?.text || null, raw: openAiRes } });
      } catch (_) {}

      // log response length only (avoid full text in logs)
      try { /* debug removed */ } catch(_) {}
      // also persist a small trace to ExecutionLogs for easier post-mortem (no full text stored to DB)
      try { await putLog({ userId, type: 'openai-call', accountId: acct.accountId, targetId: scheduledPostId, status: 'info', message: 'openai_call_complete', detail: { textLength: text ? String(text).length : 0 } }); } catch (_) {}
    } catch (e) {
      // record failure and rethrow to be handled by caller
      try { console.error('[error] OpenAI call failed', String(e)); } catch(_) {}
      try { await putLog({ userId, type: 'openai-call', accountId: acct.accountId, targetId: scheduledPostId, status: 'error', message: 'openai_call_failed', detail: { error: String(e) } }); } catch (_) {}
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_FAIL_REASON', payload: { scheduledPostId, reason: 'openai_call_failed', error: String(e) } }); } catch(_) {}
      throw e;
    }

      if (text) {
      // 編集モーダルと同様の処理：プロンプトの指示部分を除去
      let cleanText = text.trim();
      
      // プロンプトの指示部分が含まれている場合の除去処理
      if (cleanText.includes("【指示】") || cleanText.includes("【運用方針】") || cleanText.includes("【アカウントのペルソナ】")) {
        // 投稿本文の開始位置を特定（最後の指示セクション以降）
        const instructionIndex = cleanText.lastIndexOf("【指示】");
        if (instructionIndex !== -1) {
          // 【指示】以降のテキストを除去
          cleanText = cleanText.substring(0, instructionIndex).trim();
        }
        
        // 他の指示セクションも除去
        cleanText = cleanText.replace(/【運用方針[^】]*】\n?/g, "");
        cleanText = cleanText.replace(/【アカウントのペルソナ】\n?[^【]*\n?/g, "");
        cleanText = cleanText.replace(/【投稿テーマ】\n?[^【]*\n?/g, "");
        
        // 空行を整理
        cleanText = cleanText.replace(/\n\s*\n/g, "\n").trim();
      }
      
      // 最終的なテキストが空でない場合のみ保存
      if (cleanText && cleanText.length > 10) {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } },
          // 保存時に本文が入ったため needsContentAccount を削除し、pendingForAutoPostAccount をセット
          // さらに status を 'scheduled' に更新して自動投稿ワーカーが対象にできるようにする
          UpdateExpression: "SET content = :c, pendingForAutoPostAccount = :acc, #st = :scheduled REMOVE needsContentAccount",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: { ":c": { S: cleanText }, ":acc": { S: acct.accountId }, ":scheduled": { S: "scheduled" } },
        }));
        try { /* debug removed */ } catch(_) {}
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "ok", message: "本文生成を完了" });
        // dump updated scheduled item (short) for test inspection
        try {
          const got = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${scheduledPostId}` } }, ProjectionExpression: 'scheduledPostId, status, content, pendingForAutoPostAccount, numericPostId' }));
          const it = unmarshall(got.Item || {});
          try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'UPDATED_SCHEDULED_ITEM', payload: { scheduledPostId: it.scheduledPostId || scheduledPostId, status: it.status || null, contentSample: String((it.content||'')).slice(0,200), pendingForAutoPostAccount: it.pendingForAutoPostAccount || null, numericPostId: it.numericPostId || null } }); } catch(_) {}
        } catch (e) { /* non-fatal */ }
        return true;
      } else {
        try { console.warn('[warn] generated text invalid or too short', { scheduledPostId, originalLength: text ? String(text).length : 0, cleanedLength: cleanText ? cleanText.length : 0 }); } catch(_) {}
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "error", message: "生成されたテキストが不正です", detail: { originalText: text, cleanedText: cleanText } });
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_FAIL_REASON', payload: { scheduledPostId, reason: 'generated_text_invalid', originalLength: text ? String(text).length : 0, cleanedLength: cleanText ? cleanText.length : 0 } }); } catch(_) {}
        return false;
      }
    }
  } catch (e) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "error", message: "本文生成に失敗", detail: { error: String(e) } });
    return false;
  }
  // If we reach here without explicit success, return false
  return false;
}

// 任意の実行ログ出力（テーブル未作成時は黙ってスキップ）
async function putLog({
  userId = DEFAULT_USER_ID,
  type,
  accountId = "",
  targetId = "",
  status = "info",
  message = "",
  detail = {},
  persist = false, // explicit force-persist flag for debug
}: any) {
  // Persistence policy:
  // - persist if explicit persist=true
  // - persist if status === 'error' and userId is present (user-actionable errors)
  // - if ALLOW_DEBUG_EXEC_LOGS env is set, persist non-error logs too
  const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
  const shouldPersist = Boolean(persist) || (status === 'error' && !!userId) || (allowDebug && status !== 'skip');

  if (!shouldPersist) {
    try { /* debug removed */ } catch (_) {}
    return;
  }

  const now = nowSec();
  const pk = userId ? `USER#${userId}` : `LOG#${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
  const sk = `LOG#${Date.now()}#${crypto.randomUUID()}`;

  const item: any = {
    PK: { S: pk },
    SK: { S: sk },
    action: { S: type || "system" },
    createdAt: { N: String(now) },
    status: { S: status },
    message: { S: String(message || "") },
    detail: { S: JSON.stringify(detail || {}).slice(0, 35000) },
  };

  if (accountId) item.accountId = { S: String(accountId) };
  if (targetId) item.targetId = { S: String(targetId) };
  // preserve any numeric summary if provided in detail
  if (typeof (detail || {}).deletedCount === 'number') item.deletedCount = { N: String((detail || {}).deletedCount) };
  // Set TTL attr for new logs so DynamoDB TTL can remove them automatically if enabled.
  try { await config.loadConfig(); } catch (_) {}
  try {
    const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || process.env.RETENTION_DAYS || '7') || 7;
    if (retentionDays > 0) {
      const ttlAt = now + (retentionDays * 24 * 60 * 60);
      item.ttlAt = { N: String(ttlAt) };
    }
  } catch (_) {}

  // Persist to DynamoDB and also capture small amount to test output if requested
  try {
    await ddb.send(new PutItemCommand({ TableName: TBL_LOGS, Item: item }));
  } catch (e) {
    const error = e as Error;
    console.warn("[warn] putLog skipped:", String(error?.name || error));
  }

  // If this invocation is a test invocation, capture a redacted sample into __TEST_OUTPUT__ for event response
  try {
    if ((global as any).__TEST_CAPTURE__) {
      const sample: any = { userId: userId || null, type: type || null, status: status || null, message: String(message || '').slice(0,200) };
      // include partial token-like snippets if present in detail under known keys, redacted
      if (detail && typeof detail === 'object') {
        const maybeToken = detail?.token || detail?.oauthAccessToken || detail?.accessToken || null;
        if (maybeToken && typeof maybeToken === 'string') sample.tokenPreview = '***' + String(maybeToken).slice(-6);
      }
      (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
      (global as any).__TEST_OUTPUT__.push({ tag: 'PUTLOG_CAPTURE', payload: sample });
    }
  } catch (_) {}
}

// persistDebugLog removed (test utility)

type EventLike = { userId?: string };

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
const MASTER_DISCORD_WEBHOOK = process.env.MASTER_DISCORD_WEBHOOK || "";

/// ========== ハンドラ（5分＆毎時の分岐 + テストモード） ==========
// Backfill: attach TTL to a small batch of ExecutionLogs items to avoid large-scale deletes.
// Runs at most `maxUpdates` updates per invocation. Uses attribute `ttlAt` (epoch seconds).
async function backfillExecutionLogsTTLBatch(maxUpdates = 20) {
  try {
    try { await config.loadConfig(); } catch(_) {}
    const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || process.env.RETENTION_DAYS || '7') || 7;
    const ttlVal = Math.floor(Date.now() / 1000) + (retentionDays * 24 * 60 * 60);

    let lastKey: any = undefined;
    let updated = 0;
    do {
      const s = await ddb.send(new ScanCommand({ TableName: TBL_LOGS, ProjectionExpression: 'PK,SK,ttlAt', ExclusiveStartKey: lastKey, Limit: 200 }));
      const its = (s as any).Items || [];
      for (const it of its) {
        if (updated >= maxUpdates) break;
        try {
          if (it.ttlAt) continue; // already has TTL
          await ddb.send(new UpdateItemCommand({
            TableName: TBL_LOGS,
            Key: { PK: it.PK, SK: it.SK },
            UpdateExpression: 'SET ttlAt = :t',
            ConditionExpression: 'attribute_not_exists(ttlAt)',
            ExpressionAttributeValues: { ':t': { N: String(ttlVal) } }
          }));
          updated++;
        } catch (e) {
          // ignore per-item failures (concurrent updates, throttling etc.)
        }
      }
      lastKey = (s as any).LastEvaluatedKey;
      if (updated >= maxUpdates) break;
    } while (lastKey);

    return updated;
  } catch (e) {
    console.warn('[warn] backfillExecutionLogsTTLBatch failed:', String(e));
    return 0;
  }
}

export const handler = async (event: any = {}) => {
  const job = event?.job || "every-5min";
  // handler invoked (lean logging for production)

  // If invoked as a test invocation, enable in-memory capture of debug putLog entries
  try {
    // Treat event.dryRun as a test-capture flag so callers can request dry-run behavior.
    (global as any).__TEST_CAPTURE__ = !!(event && (event.testInvocation || event.detailedDebug || event.dryRun));
    if ((global as any).__TEST_CAPTURE__) (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
  } catch (_) {}

  // Unified AppConfig load at handler startup to avoid inconsistent loads across flows
  try {
    await config.loadConfig();
      // try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'APPCONFIG_LOADED', payload: { ok: true } }); } catch (_) {}
    // Build test-time handler-invoked snapshot using AppConfig values (not process.env)
    try {
      const cfgOpenAi = (() => { try { return config.getConfigValue('OPENAI_API_KEY', null); } catch (_) { return null; } })();
      const cfgQuotePrompt = (() => { try { return config.getConfigValue('QUOTE_PROMPT', null); } catch (_) { return null; } })();
      const cfgThreads = (() => { try { return config.getConfigValue('TBL_THREADS_ACCOUNTS', null); } catch (_) { return null; } })();
      const envSnapshot: any = {
        OPENAI_API_KEY_present: !!cfgOpenAi,
        QUOTE_PROMPT_present: !!cfgQuotePrompt,
        ALLOW_DEBUG_EXEC_LOGS: process.env.ALLOW_DEBUG_EXEC_LOGS || '',
        TBL_THREADS_ACCOUNTS: cfgThreads || '',
      };
      if (event?.testInvocation || event?.detailedDebug) {
        // (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
        // try { (global as any).__TEST_OUTPUT__.push({ tag: 'HANDLER_INVOKED', payload: { event: event, env: envSnapshot } }); } catch (_) {}
      }
      // try { (global as any).__TEST_OUTPUT__.push({ tag: 'APPCONFIG_VALUES', payload: { OPENAI_API_KEY_present_in_appconfig: !!cfgOpenAi, OPENAI_API_KEY_mask: cfgOpenAi ? ('***' + String(cfgOpenAi).slice(-6)) : null, QUOTE_PROMPT_present_in_appconfig: !!cfgQuotePrompt, TBL_THREADS_ACCOUNTS_in_appconfig: !!cfgThreads } }); } catch(_) {}
    } catch (_) {}
  } catch (e) {
    // Record failure; in testInvocation return error so user sees failure early
    try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'APPCONFIG_ERROR', payload: { error: String(e) } }); } catch (_) {}
    try { await putLog({ type: 'system', status: 'error', message: 'AppConfig load failed at handler startup', detail: { error: String(e) } }); } catch (_) {}
    if (event?.testInvocation) {
      const testOut = (global as any).__TEST_OUTPUT__ || [];
      try { (global as any).__TEST_OUTPUT__ = []; } catch(_) {}
      return { statusCode: 500, body: JSON.stringify({ testInvocation: true, error: 'AppConfig load failed', testOutput: testOut }) };
    }
    // otherwise continue and allow per-call callers to handle missing config
  }

  // Support a direct AppConfig check action for tests
  if (event?.checkAppConfig) {
    try {
      await config.loadConfig();
      const keys = ['OPENAI_API_KEY', 'QUOTE_PROMPT', 'TBL_THREADS_ACCOUNTS'];
      const out: any = {};
      for (const k of keys) {
        try { out[k] = config.getConfigValue(k, null); } catch (e) { out[k] = null; }
      }
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'APPCONFIG', payload: out }); } catch (_) {}
      const testOut = (global as any).__TEST_OUTPUT__ || [];
      try { (global as any).__TEST_OUTPUT__ = []; } catch(_) {}
      return { statusCode: 200, body: JSON.stringify({ testInvocation: true, action: 'checkAppConfig', result: out, testOutput: testOut }) };
    } catch (e) {
      try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'APPCONFIG_ERROR', payload: String(e) }); } catch(_) {}
      return { statusCode: 500, body: JSON.stringify({ testInvocation: true, action: 'checkAppConfig', error: String(e), testOutput: (global as any).__TEST_OUTPUT__ || [] }) };
    }
  }

  

  // If caller provided a userId for hourly/5min jobs, run only that user's flow
  // and return a test-oriented response including which accounts were targeted.
  if (event?.userId && (job === 'hourly' || job === 'every-5min')) {
    // normalize incoming userId: accept both "USER#..." and raw id
    const rawUserId = String(event.userId || '');
    const userId = rawUserId.replace(/^USER#/, '');
    try {
      // testInvocation flag is accepted for diagnostics only; do not gate quote posting on it
      const accounts = await getThreadsAccounts(userId);
      const accountIds = (accounts || []).map((a: any) => a.accountId).filter(Boolean);
      if (job === 'hourly') {
        // hourly job will run reservation creation; quote posting is not gated by test flag
        const res = await runHourlyJobForUser(userId, { dryRun: !!event?.dryRun });
        // For test mode, also process deletion queue for this user so tests exercise deletion flow
        let dqRes: any = { deletedCount: 0 };
        try {
          dqRes = await processDeletionQueueForUser(userId, { dryRun: !!event?.dryRun });
        } catch (e) {
          console.warn('[TEST] processDeletionQueueForUser failed:', String(e));
          try { await putLog({ userId, type: 'deletion', status: 'error', message: 'test_process_deletion_failed', detail: { error: String(e) } }); } catch(_){}
        }
        const merged = Object.assign({}, res || {}, { deletedCount: Number(dqRes?.deletedCount || 0) });
        const testOut = (global as any).__TEST_OUTPUT__ || [];
        try { (global as any).__TEST_OUTPUT__ = []; } catch(_) {}
        return { statusCode: 200, body: JSON.stringify({ testInvocation: true, job: 'hourly', userId, accountIds, result: merged, testOutput: testOut }) };
      } else {
        
        const res = await runFiveMinJobForUser(userId, { dryRun: !!event?.dryRun });
        // attach any collected test-time output from threads lib so caller can inspect POST bodies
        const testOut = (global as any).__TEST_OUTPUT__ || [];
        try { (global as any).__TEST_OUTPUT__ = []; } catch(_) {}
        return { statusCode: 200, body: JSON.stringify({ testInvocation: true, job: 'every-5min', userId, accountIds, result: res, testOutput: testOut }) };
      }
    } catch (e) {
      console.warn('[TEST] user-specific job failed:', String(e));
      return { statusCode: 500, body: JSON.stringify({ testInvocation: true, job, userId: event?.userId, error: String(e) }) };
    }
  }

  // Legacy interactive 'test' branch removed per request.
  // If ad-hoc/test actions are needed in the future, add a controlled debug endpoint.

  // === 集計用の開始時刻 ===
  const startedAt = Date.now();
  const userSucceeded = 0;

  if (job === "hourly") {
    // Global hourly processing: iterate active users and run per-user hourly job
    try {
      const userIds = await getActiveUserIds();
      const totals = { createdCount: 0, fetchedReplies: 0, replyDrafts: 0, skippedAccounts: 0, deletedCount: 0 } as any;
      let succeeded = 0;
    for (const uid of userIds) {
        try {
          const res = await runHourlyJobForUser(uid, { dryRun: !!event?.dryRun });
          succeeded += 1;
          totals.createdCount += Number(res.createdCount || 0);
          totals.fetchedReplies += Number(res.fetchedReplies || 0);
          totals.replyDrafts += Number(res.replyDrafts || 0);
          totals.skippedAccounts += Number(res.skippedAccounts || 0);
        // Also attempt to process deletion queue for this user (batch deletions)
        try {
          const dqRes = await processDeletionQueueForUser(uid, { dryRun: !!event?.dryRun });
          totals.deletedCount = (totals.deletedCount || 0) + Number(dqRes?.deletedCount || 0);
        } catch (e) {
          try { await putLog({ userId: uid, type: 'prune', status: 'warn', message: 'processDeletionQueueForUser failed', detail: { error: String(e) } }); } catch(_) {}
        }
        } catch (e) {
          try { await putLog({ userId: uid, type: 'hourly', status: 'error', message: 'run_hourly_failed', detail: { error: String(e) } }); } catch(_) {}
        }
      }

      // Notify master channel with summary (best-effort)
      try { await postDiscordMaster(formatMasterMessage({ job: 'hourly', startedAt, finishedAt: Date.now(), userTotal: userIds.length, userSucceeded: succeeded, totals })); } catch(_) {}

      return { statusCode: 200, body: JSON.stringify({ processedUsers: userIds.length, userSucceeded: succeeded, totals }) };
    } catch (e) {
      console.warn('[error] hourly global processing failed:', String(e));
      return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
    }
  }

  // daily prune: delete scheduled posts older than 7 days
  // NOTE: caller can request full-table operation by omitting event.userId
  if (job === "daily-prune" || job === "prune") {
    // Options:
    // - event.dryRun (boolean): true = do not delete, only count and log candidates
    // - event.userId (string): if provided, only run for that user
    const dryRun = !!event.dryRun || !!event?.testInvocation || !!event?.dryRun;
    const singleUser = event.userId || null;
    const deletePosted = !!event.deletePosted; // if true, perform deletion of posted records
    const confirmPostedDelete = !!event.confirm; // safety: require confirm=true to actually delete posted items

    const userIds = singleUser ? [singleUser] : await getActiveUserIds();
    // If no userId specified, also compute pre-filter total across the whole table
    let preFilterTotal: number | null = null;
    if (!singleUser) {
      try {
        preFilterTotal = await countAllScheduledPosts();
        // Also compute total ExecutionLogs table size for visibility
        let preFilterLogTotal = 0;
        try { preFilterLogTotal = await countAllExecutionLogs(); } catch (e) { preFilterLogTotal = 0; }
        // pre-filter Discord summary suppressed per operator request
      } catch (e) {
        console.warn('[warn] countAllScheduledPosts failed:', e);
      }
    }
    let totalDeleted = 0;
    let totalCandidates = 0;
    let totalScanned = 0;
    // ExecutionLogs counters
    let totalLogCandidates = 0;
    let totalLogDeleted = 0;
    // measure scan+delete phase
    const prunePhaseStart = Date.now();
    for (const uid of userIds) {
      try {
        // If deletePosted mode is requested, only allow single-user operations for safety
        if (deletePosted) {
          if (!singleUser) {
            // skip global posted-deletion for safety
            await putLog({ userId: uid, type: "prune", status: "error", message: "deletePosted requested but no userId specified; skipping" });
            continue;
          }
          if (dryRun) {
            const res = await countPostedCandidates(uid);
            const cands = res?.candidates || 0;
            const scanned = res?.scanned || 0;
            await putLog({ userId: uid, type: "prune", status: "info", message: `dry-run deletePosted: ${cands} candidates (scanned=${scanned})` });
            totalCandidates += cands;
            totalScanned += scanned;
            continue;
          }
          // non-dry-run: require explicit confirmation to perform posted deletion
          if (!confirmPostedDelete) {
            await putLog({ userId: uid, type: "prune", status: "warn", message: "deletePosted requested but not confirmed (confirm=false); skipping" });
            continue;
          }
          const del = await deletePostedForUser(uid);
          totalDeleted += Number(del || 0);
          continue;
        }
        if (dryRun) {
          const res = await countPruneCandidates(uid);
          const cands = res?.candidates || 0;
          const scanned = res?.scanned || 0;
          // count log candidates as well
          let logCands = 0;
          try { logCands = await countPruneExecutionLogs(uid); } catch (_) { logCands = 0; }
          totalCandidates += cands;
          totalScanned += scanned;
          totalLogCandidates += Number(logCands || 0);
          await putLog({ userId: uid, type: "prune", status: "info", message: `dry-run: ${cands} 削除候補 (scanned=${scanned}), logs=${logCands}` });
          continue;
        }
        const c = await pruneOldScheduledPosts(uid);
        totalDeleted += Number(c || 0);
        // Also prune X scheduled posts for this user (same DB-only deletion semantics)
        try {
          const cx = await pruneOldXScheduledPosts(uid);
          totalDeleted += Number(cx || 0);
        } catch (e) { console.warn('[warn] pruneOldXScheduledPosts failed for', uid, e); }
        // 実行ログも削除
        try {
          const dl = await pruneOldExecutionLogs(uid);
          totalDeleted += Number(dl || 0);
          totalLogDeleted += Number(dl || 0);
        } catch (e) { console.warn('[warn] pruneOldExecutionLogs failed for', uid, e); }
        // Replies（返信）も削除
        try {
          const dr = await pruneOldReplies(uid);
          totalDeleted += Number(dr || 0);
        } catch (e) { console.warn('[warn] pruneOldReplies failed for', uid, e); }
      } catch (e) {
        console.warn("[warn] daily-prune failed for", uid, e);
        await putLog({ userId: uid, type: "prune", status: "error", message: "daily prune failed", detail: { error: String(e) } });
      }
    }

    const prunePhaseEnd = Date.now();
    const pruneMs = prunePhaseEnd - prunePhaseStart;
    if (dryRun) {
      const finishedAt = Date.now();
      // build totals object expected by formatMasterMessage
      const t: any = { candidates: totalCandidates, scanned: totalScanned, deleted: 0, preFilterTotal, logCandidates: totalLogCandidates, pruneMs };
      // Provide fallback fields so formatMasterMessage can render detailed lines
      t.scheduledNormalDeleted = 0;
      t.scheduledNormalTotal = 0;
      t.scheduledQuoteDeleted = 0;
      t.scheduledQuoteTotal = 0;
      t.repliesDeleted = 0;
      t.repliesTotal = 0;
      t.executionLogsDeleted = 0;
      t.executionLogsTotal = Number(await (async function(){ try { return await countAllExecutionLogs(); } catch(_) { return 0; } })());
      t.usageCountersDeleted = 0;
      t.usageCountersTotal = 0;

      // Attempt to compute actual totals for dry-run reporting (may be expensive)
      try {
        await config.loadConfig();
        const scanPage = Number(config.getConfigValue('PRUNE_SCAN_PAGE_SIZE') || process.env.PRUNE_SCAN_PAGE_SIZE || '1000') || 1000;

        // ScheduledPosts: count by type
        let last: any = undefined;
        let normalCnt = 0;
        let quoteCnt = 0;
        do {
          // 'type' is a reserved word in DynamoDB projection; use ExpressionAttributeNames
          const s = await ddb.send(new ScanCommand({ TableName: TBL_SCHEDULED, ProjectionExpression: '#tp', ExpressionAttributeNames: { '#tp': 'type' }, ExclusiveStartKey: last, Limit: scanPage }));
          const items = (s.Items || []);
          for (const it of items) {
            try {
              const typ = (getS(it.type) || getS(it['#tp']) || '').toLowerCase();
              if (typ === 'quote') quoteCnt++; else normalCnt++;
            } catch (e) {
              try { console.warn('[warn] inspect scheduled item type failed', String(e)); } catch(_) {}
            }
          }
          last = (s as any).LastEvaluatedKey;
        } while (last);
        t.scheduledNormalTotal = normalCnt;
        t.scheduledQuoteTotal = quoteCnt;

        // Replies total
        last = undefined;
        let repliesCnt = 0;
        do {
          const s = await ddb.send(new ScanCommand({ TableName: TBL_REPLIES, ProjectionExpression: 'PK', ExclusiveStartKey: last, Limit: scanPage }));
          repliesCnt += (s.Count || 0);
          last = (s as any).LastEvaluatedKey;
        } while (last);
        t.repliesTotal = repliesCnt;

        // UsageCounters total
        last = undefined;
        let usageCnt = 0;
        do {
          const s = await ddb.send(new ScanCommand({ TableName: TBL_USAGE, ProjectionExpression: 'PK,SK,updatedAt', ExclusiveStartKey: last, Limit: scanPage }));
          usageCnt += (s.Count || 0);
          last = (s as any).LastEvaluatedKey;
        } while (last);
        t.usageCountersTotal = usageCnt;
      } catch (e) {
        try { console.warn('[warn] dry-run totals scan failed:', String(e)); } catch(_) {}
      }

      // Compute deletion candidates counts (items that would be deleted) for dry-run
      try {
        // scheduled posts candidates by postedAt/scheduledAt
        await config.loadConfig();
        const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || '7') || 7;
        const execPruneDays = Number(config.getConfigValue('EXECUTION_LOGS_PRUNE_DELAY_DAYS') || String(retentionDays + 1)) || (retentionDays + 1);
        const scheduledThreshold = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
        const execThreshold = Math.floor(Date.now() / 1000) - (execPruneDays * 24 * 60 * 60);

        let last: any = undefined;
        let scheduledNormalCandidates = 0;
        let scheduledQuoteCandidates = 0;
        do {
          const s = await ddb.send(new ScanCommand({ TableName: TBL_SCHEDULED, ProjectionExpression: 'scheduledAt,postedAt,#tp', ExpressionAttributeNames: { '#tp': 'type' }, ExclusiveStartKey: last, Limit: Number(config.getConfigValue('PRUNE_SCAN_PAGE_SIZE') || process.env.PRUNE_SCAN_PAGE_SIZE || '1000') }));
          for (const it of (s.Items || [])) {
            try {
              const scheduledAt = normalizeEpochSec(getN(it.scheduledAt) || 0);
              const postedAt = normalizeEpochSec(getN(it.postedAt) || 0);
              const compareAt = postedAt > 0 ? postedAt : scheduledAt;
              if (!compareAt) continue;
              if (compareAt <= scheduledThreshold) {
                const typ = (getS(it.type) || getS(it['#tp']) || '').toLowerCase();
                if (typ === 'quote') scheduledQuoteCandidates++; else scheduledNormalCandidates++;
              }
            } catch (_) {}
          }
          last = (s as any).LastEvaluatedKey;
        } while (last);

        // ExecutionLogs candidates
        last = undefined;
        let execCandidates = 0;
        do {
          const s = await ddb.send(new ScanCommand({ TableName: TBL_LOGS, ProjectionExpression: 'createdAt', ExclusiveStartKey: last, Limit: Number(config.getConfigValue('PRUNE_SCAN_PAGE_SIZE') || process.env.PRUNE_SCAN_PAGE_SIZE || '1000') }));
          for (const it of (s.Items || [])) {
            try {
              const createdAt = Number(it.createdAt?.N || 0);
              if (createdAt && createdAt <= execThreshold) execCandidates++;
            } catch (_) {}
          }
          last = (s as any).LastEvaluatedKey;
        } while (last);

        // Replies candidates
        last = undefined;
        let repliesCandidates = 0;
        do {
          const s = await ddb.send(new ScanCommand({ TableName: TBL_REPLIES, ProjectionExpression: 'createdAt', ExclusiveStartKey: last, Limit: Number(config.getConfigValue('PRUNE_SCAN_PAGE_SIZE') || process.env.PRUNE_SCAN_PAGE_SIZE || '1000') }));
          for (const it of (s.Items || [])) {
            try {
              const createdAt = Number(it.createdAt?.N || 0);
              if (createdAt && createdAt <= scheduledThreshold) repliesCandidates++;
            } catch (_) {}
          }
          last = (s as any).LastEvaluatedKey;
        } while (last);

        // UsageCounters candidates (updatedAt)
        last = undefined;
        let usageCandidates = 0;
        const usageThreshold = Math.floor(Date.now() / 1000) - (Number(config.getConfigValue('RETENTION_DAYS_LOGS') || '20') * 24 * 60 * 60);
        do {
          const s = await ddb.send(new ScanCommand({ TableName: TBL_USAGE, ProjectionExpression: 'updatedAt', ExclusiveStartKey: last, Limit: Number(config.getConfigValue('PRUNE_SCAN_PAGE_SIZE') || process.env.PRUNE_SCAN_PAGE_SIZE || '1000') }));
          for (const it of (s.Items || [])) {
            try {
              const updatedAt = normalizeEpochSec(getN(it.updatedAt) || 0);
              if (updatedAt && updatedAt <= usageThreshold) usageCandidates++;
            } catch (_) {}
          }
          last = (s as any).LastEvaluatedKey;
        } while (last);

        t.scheduledNormalDeleted = scheduledNormalCandidates;
        t.scheduledQuoteDeleted = scheduledQuoteCandidates;
        t.repliesDeleted = repliesCandidates;
        t.executionLogsDeleted = execCandidates;
        t.usageCountersDeleted = usageCandidates;
      } catch (e) {
        try { console.warn('[warn] dry-run candidate count failed:', String(e)); } catch(_) {}
      }
      await postDiscordMaster(formatMasterMessage({ job: "daily-prune", startedAt, finishedAt, userTotal: userIds.length, userSucceeded: 0, totals: t }));
      return { statusCode: 200, body: JSON.stringify({
        dryRun: true,
        preFilterTotal,
        candidates: totalCandidates,
        scanned: totalScanned,
        logCandidates: totalLogCandidates,
        pruneMs,
        scheduledNormalDeleted: t.scheduledNormalDeleted,
        scheduledQuoteDeleted: t.scheduledQuoteDeleted,
        repliesDeleted: t.repliesDeleted,
        executionLogsDeleted: t.executionLogsDeleted,
        usageCountersDeleted: t.usageCountersDeleted,
        scheduledNormalTotal: t.scheduledNormalTotal,
        scheduledQuoteTotal: t.scheduledQuoteTotal,
        repliesTotal: t.repliesTotal,
        executionLogsTotal: t.executionLogsTotal,
        usageCountersTotal: t.usageCountersTotal
      }) };
    }

    // If no userId was specified, perform full-table prune
    if (!singleUser) {
    // Previously required confirmFull; allow full-table prune without confirmFull for operator-triggered calls
      try {
        // Before performing a full-table prune, reset any accounts that are
        // in `deleting` state but have no DeletionQueue entry. This avoids
        // accounts stuck in deleting when the queue was removed or never created.
        try {
          await config.loadConfig();
          const dqTable = config.getConfigValue('TBL_DELETION_QUEUE') || process.env.TBL_DELETION_QUEUE || 'DeletionQueue';
          const tThreads = config.getConfigValue('TBL_THREADS_ACCOUNTS') || process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
          const resetAge = Number(config.getConfigValue('DELETION_RESET_AGE_SECONDS') || process.env.DELETION_RESET_AGE_SECONDS || '86400') || 86400;
          const nowTs = nowSec();

          // build set of queued accountIds
          const queued = new Set();
          let lastK: any = undefined;
          do {
            const s = await ddb.send(new ScanCommand({ TableName: dqTable, ProjectionExpression: 'accountId', ExclusiveStartKey: lastK, Limit: 1000 }));
            const its = (s as any).Items || [];
            for (const it of its) {
              const aid = getS(it.accountId);
              if (aid) queued.add(aid);
            }
            lastK = (s as any).LastEvaluatedKey;
          } while (lastK);

          // scan ThreadsAccounts for status = deleting and reset stale ones
          let lastKey2: any = undefined;
          do {
            const scanRes = await ddb.send(new ScanCommand({ TableName: tThreads, ProjectionExpression: 'PK,SK,accountId,updatedAt,status', FilterExpression: '#st = :d', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':d': { S: 'deleting' } }, ExclusiveStartKey: lastKey2, Limit: 200 }));
            const items2 = (scanRes as any).Items || [];
            for (const it of items2) {
              const accId = getS(it.accountId) || '';
              if (!accId) continue;
              if (queued.has(accId)) continue; // still queued
              const updatedAt = it.updatedAt?.N ? Number(it.updatedAt.N) : 0;
              if (nowTs - updatedAt < resetAge) continue; // too recent
              const pk = getS(it.PK) || '';
              const sk = getS(it.SK) || '';
              const ownerUserId = pk.startsWith('USER#') ? pk.replace(/^USER#/, '') : pk;
              try {
                await ddb.send(new UpdateItemCommand({ TableName: tThreads, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: 'SET #st = :a, updatedAt = :n', ConditionExpression: '#st = :d', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':a': { S: 'active' }, ':n': { N: String(nowTs) }, ':d': { S: 'deleting' } } }));
                await putLog({ userId: ownerUserId, action: 'deletion_reset', status: 'info', accountId: accId, message: 'reset deleting->active', detail: { resetAge } });
              } catch (e) {
                // conditional update may fail if status changed concurrently; ignore
              }
            }
            lastKey2 = (scanRes as any).LastEvaluatedKey;
          } while (lastKey2);
        } catch (e) {
          console.warn('[warn] deletion reset scan failed:', String(e));
        }

        const allDeleted = await pruneOldScheduledPostsAll();
        // full-table prune for X scheduled posts as well
        let allXDeleted = 0;
        try { allXDeleted = await pruneOldXScheduledPostsAll(); } catch (_) { allXDeleted = 0; }
        // also perform full-table execution logs prune
        let allLogDeleted = 0;
        try { allLogDeleted = await pruneOldExecutionLogsAll(); } catch (_) { allLogDeleted = 0; }
        // also remove orphan (non-user) ExecutionLogs entries that TTL may have missed
        let orphanLogDeleted = 0;
        try { orphanLogDeleted = await pruneOrphanExecutionLogsAll(); } catch (_) { orphanLogDeleted = 0; }
        const finishedAt = Date.now();
    const pruneMsAll = finishedAt - prunePhaseStart;
        const t = { candidates: totalCandidates, scanned: totalScanned, deleted: allDeleted + (allXDeleted||0), xDeleted: allXDeleted, preFilterTotal, logDeleted: allLogDeleted, orphanLogDeleted, pruneMs: pruneMsAll } as any;
        await postDiscordMaster(formatMasterMessage({ job: "daily-prune", startedAt, finishedAt, userTotal: userIds.length, userSucceeded, totals: t }));
        return { statusCode: 200, body: JSON.stringify({ deleted: allDeleted, logDeleted: allLogDeleted, preFilterTotal }) };
      } catch (e) {
        console.warn('[warn] full-table prune failed:', e);
        await postDiscordMaster(`**[PRUNE] full-table prune failed**`);
        return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
      }
    }

    const finishedAt = Date.now();
    const t = { candidates: totalCandidates, scanned: totalScanned, deleted: totalDeleted, preFilterTotal } as any;
    await postDiscordMaster(formatMasterMessage({ job: "daily-prune", startedAt, finishedAt, userTotal: userIds.length, userSucceeded, totals: t }));
    return { statusCode: 200, body: JSON.stringify({ deleted: totalDeleted }) };
  }

  // every-5min（デフォルト）
  // Global every-5min: iterate active users and run per-user 5min job
  try { console.info('[info] every-5min global processing enabled'); } catch(_) {}
  try {
    const userIds = await getActiveUserIds();
    let succeeded = 0;
    const totals: any = { totalAuto: 0, totalReply: 0, totalTwo: 0, totalX: 0, rateSkipped: 0 };
    for (const uid of userIds) {
      try {
        const res = await runFiveMinJobForUser(uid, { dryRun: !!event?.dryRun });
        succeeded += 1;
        totals.totalAuto += Number(res.totalAuto || 0);
        totals.totalReply += Number(res.totalReply || 0);
        totals.totalTwo += Number(res.totalTwo || 0);
        totals.rateSkipped += Number(res.rateSkipped || 0);
      } catch (e) {
        try { await putLog({ userId: uid, type: 'every-5min', status: 'error', message: 'run5min_failed', detail: { error: String(e) } }); } catch(_) {}
      }
    }
    // Small TTL backfill for ExecutionLogs to avoid large-scale deletes.
    try {
      const ttlBackfilled = await backfillExecutionLogsTTLBatch(20);
      if (ttlBackfilled && ttlBackfilled > 0) {
        try { await postDiscordMaster(`**[BACKFILL] ExecutionLogs に ttlAt を付与しました: ${ttlBackfilled} 件**`); } catch(_) {}
      }
      totals.ttlBackfilled = Number(ttlBackfilled || 0);
    } catch (e) {
      console.warn('[warn] ttl backfill failed:', String(e));
    }
    try { await postDiscordMaster(formatMasterMessage({ job: 'every-5min', startedAt, finishedAt: Date.now(), userTotal: userIds.length, userSucceeded: succeeded, totals })); } catch(_) {}
    return { statusCode: 200, body: JSON.stringify({ processedUsers: userIds.length, userSucceeded: succeeded, totals }) };
  } catch (e) {
    console.warn('[error] every-5min global processing failed:', String(e));
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};


// These were only used by the legacy interactive `test` job and have been deleted.

// Threads の user-id を取得して ThreadsAccounts に保存
async function fetchProviderUserIdFromPlatform(acct: any) {
  const url = new URL("https://graph.threads.net/v1.0/me");
  url.searchParams.set("fields", "id,username");
  // Use oauthAccessToken exclusively when calling platform endpoints
  url.searchParams.set("access_token", acct.oauthAccessToken || '');
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Threads get me error: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  return json?.id || "";
}

// NOTE: Quote-related processing will be disabled by commenting out calls below
// for test isolation. Revert the commented sections after testing.

// DB更新つきの user-id 取得ラッパ
async function ensureProviderUserId(userId: any, acct: any) {
  if (acct?.providerUserId) return acct.providerUserId;
  // Require oauthAccessToken only (do not accept legacy accessToken fallback)
  if (!acct?.oauthAccessToken) return "";

  try {
    const pid = await fetchProviderUserIdFromPlatform(acct);
    if (pid) {
      await ddb.send(new UpdateItemCommand({
        TableName: TBL_THREADS,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${acct.accountId}` } },
        UpdateExpression: "SET providerUserId = :pid",
        ExpressionAttributeValues: { ":pid": { S: pid } },
      }));
      acct.providerUserId = pid;
    }
    return pid;
  } catch (e) {
    await putLog({
      userId, type: "account", accountId: acct.accountId,
      status: "error", message: "providerUserId取得に失敗", detail: { error: String(e) }
    });
    return "";
  }
}

// UNIX秒へ安全変換（ms/文字列/ISO 吸収）
function toUnixSec(v: any) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v > 2_000_000_000 ? Math.floor(v / 1000) : v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s.length > 10 ? Math.floor(Number(s) / 1000) : s);
  const d = new Date(s.replace(/\//g, "-").replace(" ", "T"));
  return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

// "HH:MM" → 分（0-1439）
const parseHHMM = (s: any) => {
  const [h, m] = String(s || "").split(":").map((n: any) => Number(n));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

// JSTレンジから乱数時刻を生成（翌日指定可）
const randomTimeInRangeJst = (range: any, baseJstDate: any, forNextDay = false) => {
  if (!range) return null;
  const [s, e] = range.split(/-|～|~/).map((x: any) => x.trim());
  const sm = parseHHMM(s), em = parseHHMM(e);
  if (!Number.isFinite(sm) || !Number.isFinite(em)) return null;

  const baseMs = epochStartOfJstDayMs(baseJstDate.getTime()) + (forNextDay ? MS_PER_DAY : 0);
  // Latest allowed minute is 10 minutes before range end (ensure worker running every-5min can pick up)
  const latestAllowedMin = em - 10;
  const cappedLatestMin = latestAllowedMin < sm ? sm : latestAllowedMin;
  const span = cappedLatestMin - sm;
  const pickedMin = span > 0 ? sm + Math.floor(Math.random() * (span + 1)) : sm;
  return new Date(baseMs + pickedMin * MS_PER_MIN);
};

// JST基準の YYYYMMDD（OpenAI日次制限のキーなど）
function yyyymmddJst(d: any = jstNow()) {
  const startMs = epochStartOfJstDayMs(d.getTime());
  const z = new Date(startMs + JST_OFFSET_MIN * MS_PER_MIN);
  const y = z.getUTCFullYear();
  const m = String(z.getUTCMonth() + 1).padStart(2, "0");
  const day = String(z.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// epoch秒→Date
function jstFromEpoch(sec: any) { return new Date(sec * 1000); }

// "HH:MM-HH:MM" の終了時刻（当日JSTの秒59）
function rangeEndOfDayJst(range: any, baseDateJst: any) {
  if (!range) return null;
  const endPart = range.split(/-|～|~/).map((x: any) => x.trim())[1];
  const em = parseHHMM(endPart);
  if (!Number.isFinite(em)) return null;
  const baseMs = epochStartOfJstDayMs(baseDateJst.getTime());
  const endMs = baseMs + em * MS_PER_MIN + 59 * 1000;
  return new Date(endMs);
}

// 返信の取得（毎時ジョブ用）
async function upsertReplyItem(userId: any, acct: any, { externalReplyId, postId, text, createdAt, originalPost }: any) {
  const sk = `REPLY#${externalReplyId}`;
  try {
    // 既存チェック
    const existing = await ddb.send(new GetItemCommand({
      TableName: TBL_REPLIES,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: sk } },
    }));
    
    if (existing.Item) {
      return false; // 既に存在する
    }

    // Use AppConfig exclusively for OpenAI API parameters (no fallbacks to user settings)
    let responseContent = "";
    if (acct.autoReply) {
      try {
        // Load AppConfig and require OPENAI_API_KEY to be present
        try {
          await config.loadConfig();
        } catch (e) {
          await putLog({ userId, type: "reply-generate", accountId: acct.accountId, status: "error", message: "AppConfigの読み込み失敗", detail: { error: String(e) } });
          return false;
        }

        const cfgKey = (() => { try { return config.getConfigValue('OPENAI_API_KEY'); } catch (_) { return null; } })();
        if (!cfgKey) {
          await putLog({ userId, type: "reply-generate", accountId: acct.accountId, status: "skip", message: "AppConfig に OPENAI_API_KEY が設定されていないため返信生成をスキップ" });
          return false;
        }

        // Read AppConfig-only parameters (use exact keys from AppConfig)
        const cfgModel = (() => { try { return config.getConfigValue('OPENAI_DEFAULT_MODEL'); } catch (_) { return DEFAULT_OPENAI_MODEL; } })();
        const cfgTemp = Number((() => { try { return config.getConfigValue('OPENAI_TEMPERATURE'); } catch (_) { return String(DEFAULT_OPENAI_TEMP); } })());
        const cfgMax = Number((() => { try { return config.getConfigValue('OPENAI_MAXTOKENS'); } catch (_) { return String(DEFAULT_OPENAI_MAXTOKENS); } })());

        // Build prompt without relying on user-level settings (pass empty settings object)
        const replyPrompt = buildReplyPrompt(text, originalPost?.content || "", {}, acct);

        const { text: generatedReply } = await callOpenAIText({
          apiKey: cfgKey,
          model: cfgModel || DEFAULT_OPENAI_MODEL,
          temperature: Number.isFinite(cfgTemp) ? cfgTemp : DEFAULT_OPENAI_TEMP,
          max_tokens: Number.isFinite(cfgMax) ? cfgMax : DEFAULT_OPENAI_MAXTOKENS,
          prompt: replyPrompt,
        });
        
        // Clean generated text
        let cleanReply = generatedReply || "";
        if (cleanReply) {
          cleanReply = cleanReply.trim();
          if (cleanReply.includes("【指示】") || cleanReply.includes("【運用方針】") || cleanReply.includes("【受信したリプライ】")) {
            const instructionIndex = cleanReply.lastIndexOf("【指示】");
            if (instructionIndex !== -1) cleanReply = cleanReply.substring(0, instructionIndex).trim();
            cleanReply = cleanReply.replace(/【運用方針[^】]*】\n?/g, "");
            cleanReply = cleanReply.replace(/【元の投稿】\n?[^【]*\n?/g, "");
            cleanReply = cleanReply.replace(/【受信したリプライ】\n?[^【]*\n?/g, "");
            cleanReply = cleanReply.replace(/\n\s*\n/g, "\n").trim();
          }
          cleanReply = cleanReply.replace(/^[「『"']|[」』"']$/g, "");
          cleanReply = cleanReply.replace(/^\*\*|\*\*$/g, "");
          cleanReply = cleanReply.trim();
        }
        responseContent = cleanReply;
      } catch (e) {
        console.warn(`[warn] 返信コンテンツ生成失敗: ${String(e)}`);
        await putLog({ userId, type: "reply-generate", accountId: acct.accountId, status: "error", message: "返信コンテンツ生成失敗", detail: { error: String(e) } });
      }
    }

    await ddb.send(new PutItemCommand({
      TableName: TBL_REPLIES,
      Item: {
        PK: { S: `USER#${userId}` },
        SK: { S: sk },
        accountId: { S: acct.accountId },
        postId: { S: postId },
        incomingReply: { S: text }, // 受信したリプライ内容
        replyContent: { S: responseContent }, // AI生成した返信内容
        status: { S: responseContent ? "unreplied" : "draft" },
        createdAt: { N: String(createdAt || nowSec()) },
        // 元投稿の情報も保存
        originalContent: { S: originalPost?.content || "" },
        originalPostedAt: { N: String(originalPost?.postedAt || 0) },
      },
      ConditionExpression: "attribute_not_exists(SK)",
    }));
    return true;
  } catch {
    return false;
  }
}

async function fetchThreadsRepliesAndSave({ acct, userId, lookbackSec = 24*3600 }: any) {
  
  if (!acct?.accessToken) throw new Error("Threads のトークン不足");
  if (!acct?.providerUserId) {
    const pid = await ensureProviderUserId(userId, acct);
    if (!pid) throw new Error("Threads のユーザーID取得失敗");
  }
  const since = nowSec() - lookbackSec;

  let q;
  try {
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      IndexName: GSI_POS_BY_ACC_TIME,
      KeyConditionExpression: "accountId = :acc AND postedAt >= :since",
      ExpressionAttributeValues: {
        ":acc": { S: acct.accountId },
        ":since": { N: String(since) },
        ":posted": { S: "posted" }
      },
      FilterExpression: "#st = :posted AND attribute_exists(postId)",
      ExpressionAttributeNames: { "#st": "status" },
      ProjectionExpression: "postId, numericPostId, content, postedAt",
      Limit: 20,
    }));
  } catch (e) {
    if (!isGsiMissing(e)) throw e;
    console.warn("[warn] GSI2 missing on ScheduledPosts. fallback to PK Query");
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk":     { S: `USER#${userId}` },
        ":pfx":    { S: "SCHEDULEDPOST#" },
        ":acc":    { S: acct.accountId },
        ":since":  { N: String(since) },
        ":posted": { S: "posted" }
      },
      FilterExpression: "accountId = :acc AND postedAt >= :since AND #st = :posted AND attribute_exists(postId)",
      ExpressionAttributeNames: { "#st": "status" },
      ProjectionExpression: "postId, numericPostId, content, postedAt",
      Limit: 20,
    }));
  }

    const posts = (q.Items || []).map((i: any) => ({
    postId: i.postId?.S,
    numericPostId: i.numericPostId?.S,
    content: i.content?.S || "",
    postedAt: i.postedAt?.N ? Number(i.postedAt.N) : 0,
  })).filter(p => p.postId);
  
  let saved = 0;

  for (const post of posts) {
    // 手動実行と同じID選択ロジック: 数字ID優先
    const isNumericPostId = post.numericPostId && /^\d+$/.test(post.numericPostId);
    const isNumericMainPostId = post.postId && /^\d+$/.test(post.postId);
    let replyApiId: string;
    if (isNumericPostId) replyApiId = post.numericPostId; else if (isNumericMainPostId) replyApiId = post.postId; else replyApiId = post.numericPostId || post.postId;
    const hasAlt = !!(post.numericPostId && post.postId && post.numericPostId !== post.postId);
    const alternativeId = hasAlt ? (post.numericPostId === replyApiId ? post.postId : post.numericPostId) : "";

    // 手動実行に合わせて、replies → conversation → 代替ID(replies) の順に試行
    const tokenToUse = acct.oauthAccessToken || acct.accessToken || '';
    const buildRepliesUrl = (id: string) => {
      const u = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(id)}/replies`);
      u.searchParams.set("fields", "id,text,username,permalink,is_reply_owned_by_me,replied_to,root_post");
      u.searchParams.set("access_token", tokenToUse);
      return u.toString();
    };
    const buildConversationUrl = (id: string) => {
      const u = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(id)}/conversation`);
      u.searchParams.set("fields", "id,text,username,permalink");
      u.searchParams.set("access_token", tokenToUse);
      return u.toString();
    };

    let usedUrl = buildRepliesUrl(replyApiId);
    let r = await fetch(usedUrl);
    if (!r.ok) {
      
      usedUrl = buildConversationUrl(replyApiId);
      r = await fetch(usedUrl);
      if (!r.ok && alternativeId) {
        
        usedUrl = buildRepliesUrl(alternativeId);
        r = await fetch(usedUrl);
      }
    }

    if (!r.ok) {
      const errTxt = await r.text().catch(() => "");
      await putLog({
        userId,
        type: "reply-fetch",
        accountId: acct.accountId,
        status: "error",
        message: `Threads replies error: ${r.status} for ID ${replyApiId}`,
        detail: { url: usedUrl.replace(tokenToUse, "***TOKEN***"), error: errTxt.slice(0, 200) }
      });
      continue;
    }
    const json = await r.json();
    for (const rep of (json?.data || [])) {
      // is_reply_owned_by_me フィールドが利用可能な場合はそれを優先して除外
      if (rep.is_reply_owned_by_me === true) {
        
        try {
          await putLog({
            userId,
            type: "reply-fetch-exclude",
            accountId: acct.accountId,
            status: "info",
            message: "is_reply_owned_by_me=true のため除外",
            detail: { replyId: rep.id, reason: 'is_reply_owned_by_me' }
          });
        } catch (e) {
          console.warn("[warn] putLog failed for exclude log:", e);
        }
        continue;
      }

      // フラグが付いていない場合は除外しないが、原因調査のため候補一致時にログを残す
      try {
        const authorCandidates = [
          rep.from?.id,
          rep.from?.username,
          rep.username,
          rep.user?.id,
          rep.user?.username,
          rep.author?.id,
          rep.author?.username,
        ].map(x => (x == null ? "" : String(x)));

        const s2 = (acct.secondStageContent || "").trim();
        const rt = (rep.text || "").trim();

        const potentialMatch = authorCandidates.some(a => a && acct.providerUserId && a === acct.providerUserId) || (s2 && rt && (s2.replace(/\s+/g,' ').toLowerCase() === rt.replace(/\s+/g,' ').toLowerCase()));
        if (potentialMatch) {
          const detail: any = { replyId: rep.id, authorCandidates, providerUserId: acct.providerUserId };
          if (s2 && rt) detail.secondStageSample = { s2: s2.replace(/\s+/g,' ').toLowerCase(), rt: rt.replace(/\s+/g,' ').toLowerCase() };
          await putLog({ userId, type: "reply-fetch-flag-mismatch", accountId: acct.accountId, status: "info", message: "flag missing but candidate fields matched", detail });
        }
      } catch (e) {
            console.warn('[warn] flag-mismatch logging failed in lambda:', e);
      }

      const externalReplyId = String(rep.id);
      const text = rep.text || "";
      const createdAt = nowSec();
      const ok = await upsertReplyItem(userId, acct, {
        externalReplyId,
        postId: replyApiId, // 実際に使用したIDを保存
        text,
        createdAt,
        originalPost: post,
      });
      if (ok) saved++;
    }
  }
  await putLog({ userId, type: "reply-fetch", accountId: acct.accountId, status: "ok", message: `Threads: 返信を ${saved} 件保存` });
  return { saved };
}

async function fetchIncomingReplies(userId: any, acct: any) {
  // 仕様: autoReply が OFF のアカウントはスキップ（可視化のためログを残す）
  if (!acct.autoReply) {
    try {
      await putLog({ userId, type: "reply-fetch", accountId: acct.accountId, status: "skip", message: "autoReply OFF のため取得スキップ" });
    } catch {}
    return { fetched: 0 };
  }
  try {
    const r = await fetchThreadsRepliesAndSave({ acct, userId });
    return { fetched: r.saved || 0 };
  } catch (e) {
    await putLog({ userId, type: "reply-fetch", accountId: acct.accountId, status: "error", message: "返信取得失敗", detail: { error: String(e) } });
    await postDiscordLog({
      userId,
      isError: true,
      content: `**[ERROR reply-fetch] ${acct.displayName || acct.accountId}**\n${String(e).slice(0, 800)}`
    });
    return { fetched: 0 };
  }
}

// === 予約投稿（毎時の"翌日分作成"） ===
async function ensureNextDayAutoPosts(userId: any, acct: any, opts: any = {}) {
  // アカウント側の大枠ガード
  // 注意: 自動投稿が無効なアカウントには「空の予約作成」を行わない
  if (!acct.autoGenerate || !acct.autoPost) {
    try {
      await putLog({
        userId, type: "auto-post", accountId: acct.accountId,
        status: "skip", message: `autoGenerate=${!!acct.autoGenerate}, autoPost=${!!acct.autoPost} のためスキップ`
      });
    } catch (_) {}
    return { created: 0, skipped: true };
  }
  if (acct.status && acct.status !== "active") {
    await putLog({
      userId, type: "auto-post", accountId: acct.accountId,
      status: "skip", message: `status=${acct.status} のためスキップ`
    });
    return { created: 0, skipped: true };
  }

  // グループ取得
  const group = await getAutoPostGroup(userId, acct.autoPostGroupId);
  if (!group || !group.groupName) return { created: 0, skipped: true };
  // 新形式: スロットを取得（最大10）。フォールバックは行わず、スロット未設定ならスキップ
  let slots: any[] = [];
  try {
    // group には groupKey フィールドは含まれないため、アカウント側に保持している groupId を使用
    slots = await getAutoPostGroupItems(userId, acct.autoPostGroupId);
  } catch (e) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, status: "error", message: "スロット取得に失敗", detail: { error: String(e), groupId: acct.autoPostGroupId } });
  }
  if (!slots || slots.length === 0) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, status: "skip", message: `スロット未設定のためスキップ (${group.groupName})` });
    return { created: 0, deleted: 0, skipped: true, debug: [{ reason: "no_slots", group: group.groupName }] } as any;
  }
  let useSlots = slots.slice(0, 10);
  // Override: use fixed windows (JST) for next-day scheduling: morning/noon/eve
  try {
    const fixedWindows = ["07:00-09:00", "12:00-14:00", "17:00-21:00"];
    useSlots = fixedWindows.map((w: any, i: number) => ({ timeRange: w, idx: i + 1 }));
  } catch (e) {
    // fallback to original slots if mapping fails
  }
  

  const today = jstNow();
  const settings = await getUserSettings(userId);

  let created = 0;
  let deleted = 0;
  // ← ここにタイプ毎の判定結果を積んで、最後に ExecutionLogs にまとめて出します
  const debug: any[] = [];

  // ★実績チェック（isPostedToday）は廃止：投稿がまだ無くても翌日分を作る
  let idx = 0;
  for (const slot of useSlots) {
    idx += 1;
    const groupTypeStr = `${group.groupName}-自動投稿${idx}`;
    const timeRange = String(slot.timeRange || "");

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if a reservation for this account/group/slot already exists for tomorrow; skip if so
    const exists = await existsForDate(userId, acct, groupTypeStr, tomorrow);

    // 途中経過トレース
    const trace: any = { type: idx, groupTypeStr, timeRange, exists };
    
    // timeRange 未設定
    if (!timeRange) {
      debug.push({ ...trace, reason: "no_timeRange" });
      await putLog({
        userId, type: "auto-post", accountId: acct.accountId,
        status: "skip", message: `timeRange 未設定 (${groupTypeStr})`
      });
      continue;
    }
    
    // 既に明日分が存在
    if (exists) {
      debug.push({ ...trace, reason: "already_exists" });
      await putLog({
        userId, type: "auto-post", accountId: acct.accountId,
        status: "skip", message: `明日分は既に存在 (${groupTypeStr})`
      });
      continue;
    }

    // (no deletion of previous-day unposted reservations in fixed-window mode)

    // OpenAI クレジット確保（必要ないなら下の continue を外す）
    try {
      const reserve = await reserveOpenAiCredits(userId, 1);
      trace.reserve = reserve;
      if (!reserve.ok) {
        debug.push({ ...trace, reason: "openai_limit" });
        await putLog({
          userId, type: "auto-post", accountId: acct.accountId,
          status: "skip", message: "OpenAI日次上限のため予約作成をスキップ"
        });
        continue; // ← "上限でも予約だけは作る" なら、この行を削除
      }
    } catch (e) {
      trace.reserve = { ok: false, error: String(e) };
      debug.push({ ...trace, reason: "reserve_exception" });
      await putLog({
        userId, type: "auto-post", accountId: acct.accountId,
        status: "error", message: "OpenAIクレジット確保で例外", detail: { error: String(e) }
      });
      continue;
    }

    // JSTレンジから翌日分の時刻を乱択
    let when: Date | null;
    if (timeRange) {
      when = randomTimeInRangeJst(timeRange, today, true);
    } else {
      // timeRange が空の場合は、明日を現在時刻と同じ時刻で予約する
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      when = new Date(tomorrow);
      when.setHours(today.getHours(), today.getMinutes(), 0, 0);
    }
    trace.when = when?.toISOString?.() || null;
    if (!when) {
      debug.push({ ...trace, reason: "time_pick_failed" });
      await putLog({
        userId, type: "auto-post", accountId: acct.accountId,
        status: "skip", message: `時刻生成失敗 (${groupTypeStr})`
      });
      continue;
    }

    // 予約作成 → 本文生成
    // overrideTheme may contain comma-separated themes; pick one randomly like the editor does
    let slotTheme = String(slot.theme || "");
    if (slotTheme.includes(",")) {
      const parts = slotTheme.split(",").map((s: any) => String(s).trim()).filter(Boolean);
      if (parts.length > 0) slotTheme = parts[Math.floor(Math.random() * parts.length)];
    }

    const { id, themeStr } = await createScheduledPost(userId, {
      acct, group, type: idx, whenJst: when,
      // テーマ/時間帯：スロットに設定があればそれを優先
      overrideTheme: slotTheme,
      overrideTimeRange: String(slot.timeRange || ""),
      // スロット単位の二段階投稿指定を予約データへ伝搬
      secondStageWanted: !!slot.secondStageWanted,
      // Mark this reservation as pool-driven so posting time will claim from pool
      scheduledSource: "pool",
      poolType: (acct && acct.type) ? String(acct.type) : "general",
    }, opts);
    // 短期対応: 本文生成は同期で行わず、時間ごとの処理で段階的に生成する
    // generateAndAttachContent はここでは呼ばない

    created++;
    debug.push({
      ...trace,
      reason: "created",
      created: true,
      scheduledPostId: id,
      theme: themeStr
    });
  }

  // まとめて1本、診断トレースを保存
  await putLog({
    userId,
    type: "auto-post-plan",
    accountId: acct.accountId,
    status: "trace",
    message: "ensureNextDay trace",
    detail: { group: group.groupName, debug, deleted }
  });

  // テスト時にレスポンスからも追えるよう debug を返す
  return { created, deleted, skipped: false, debug };
}

// === X 用: 翌日分の空予約作成（pool-driven） ===
async function ensureNextDayAutoPostsForX(userId: any, xacct: any, opts: any = {}) {
  // Guard: X アカウントの自動投稿が有効かつアクティブであること
  try {
    if (!xacct || xacct.autoPostEnabled !== true) {
      try { await putLog({ userId, type: "auto-post-x", accountId: xacct && xacct.accountId, status: "skip", message: `autoPostEnabled=${!!(xacct && xacct.autoPostEnabled)} のためスキップ` }); } catch(_) {}
      return { created: 0, skipped: true };
    }
    if (xacct.status && xacct.status !== "active") {
      try { await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "skip", message: `status=${xacct.status} のためスキップ` }); } catch(_) {}
      return { created: 0, skipped: true };
    }
  } catch (e) {
    console.warn('[warn] ensureNextDayAutoPostsForX guard failed:', String(e));
    return { created: 0, skipped: true };
  }
  // Debug: log entry and target table name to help diagnose missing PutItem
  try { console.info('[x-hourly] ensureNextDayAutoPostsForX start', { userId, accountId: xacct && xacct.accountId, TBL_X_SCHEDULED: process.env.TBL_X_SCHEDULED || 'XScheduledPosts' }); } catch(_) {}

  const fixedWindows = ["07:00-09:00", "12:00-14:00", "17:00-21:00"];
  // Use unified JST day infos (today/tomorrow) to ensure consistent YMD and baseDate for randomTimeInRangeJst
  const dayInfos = getJstDayInfos();
  const today = dayInfos[0].date;
  let created = 0;

  for (const w of fixedWindows) {
    try {
      const when = randomTimeInRangeJst(w, today, true); // next day
      if (!when) {
        await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "skip", message: `invalid window ${w}` });
        continue;
      }
        try { console.info('[x-hourly] when computed', { userId, accountId: xacct.accountId, window: w, whenJst: when.toISOString() }); } catch(_) {}
        // compute tomorrow's YMD in JST using unified helper
        const tomorrowYmd = dayInfos[1].ymd;
      // Require that xacct.type exists; do not fallback to 'general'. If missing, error out to avoid cross-type creation.
      if (!xacct.type) {
        try { await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "error", message: "account type missing; cannot create X scheduled posts for this account" }); } catch(_) {}
        return { created: 0, skipped: true, error: 'missing_account_type' };
      }
      // Check user-level time-bucket setting (user_type_time_settings). If user has the bucket OFF, skip creating reservation.
      try {
        const settingsTable = process.env.TBL_USER_TYPE_TIME_SETTINGS || 'UserTypeTimeSettings';
        const poolType = xacct.type;
        // Attempt GetItem with keys (user_id, type)
        const sres = await ddb.send(new GetItemCommand({ TableName: settingsTable, Key: { user_id: { S: String(userId) }, type: { S: String(poolType) } } }));
        const sitem = (sres as any).Item || {};
        const morningOn = Boolean(sitem.morning && (sitem.morning.BOOL === true || String(sitem.morning.S) === 'true'));
        const noonOn = Boolean(sitem.noon && (sitem.noon.BOOL === true || String(sitem.noon.S) === 'true'));
        const nightOn = Boolean(sitem.night && (sitem.night.BOOL === true || String(sitem.night.S) === 'true'));
        let field = 'unknown';
        if (String(w).startsWith('07')) field = 'morning';
        else if (String(w).startsWith('12')) field = 'noon';
        else if (String(w).startsWith('17')) field = 'night';
        const allowed = field === 'morning' ? morningOn : (field === 'noon' ? noonOn : (field === 'night' ? nightOn : false));
        if (!allowed) {
          await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "skip", message: `user setting ${poolType}.${field} is OFF, skip window ${w}` });
          continue;
        }
      } catch (e) {
        try { await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "error", message: "failed to read user time settings", detail: { error: String(e) } }); } catch(_) {}
        // On error reading settings, skip to avoid unintended posts
        continue;
      }
      // Check existing XScheduledPosts for same account and identical timeRange on the same next-day date
      try {
        const q = await ddb.send(new QueryCommand({
          TableName: process.env.TBL_X_SCHEDULED || 'XScheduledPosts',
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
          ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' } },
          ProjectionExpression: 'scheduledAt, accountId, timeRange',
        }));
        const items = (q as any).Items || [];
        try { console.info('[x-hourly] existing XScheduledPosts fetched', { userId, accountId: xacct.accountId, count: (items || []).length }); } catch(_) {}
        let exists = false;
        for (const it of items) {
          try {
            const aid = it.accountId?.S || '';
            const tr = it.timeRange?.S || '';
            if (aid !== xacct.accountId) continue;
            if (tr !== String(w)) continue;
            const sat = Number(it.scheduledAt?.N || 0);
            if (!sat) continue;
            const satYmd = yyyymmddJst(jstFromEpoch(sat));
            if (satYmd === tomorrowYmd) { exists = true; break; }
          } catch (_) {}
        }
        if (exists) {
          await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "skip", message: `既存予約あり ${w}` });
          continue;
        }
      } catch (e) {
        await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "error", message: "既存予約チェック失敗", detail: { error: String(e) } });
      }

      // Debug: about to evaluate creating reservation (check dry-run flag)
      try { console.info('[x-hourly] pre-create check', { userId, accountId: xacct.accountId, window: w, TEST_CAPTURE: Boolean((global as any).__TEST_CAPTURE__) }); } catch(_) {}
      // Test capture/dry-run
      if ((opts && opts.dryRun) || (global as any).__TEST_CAPTURE__) {
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'HOURLY_X_POOL_RESERVATION', payload: { userId, accountId: xacct.accountId, whenJst: when.toISOString(), poolType: xacct.type || 'general' } }); } catch(_) {}
        continue;
      }

      // Create XScheduledPosts item via dedicated X-specific function
      try {
        const res = await createXScheduledPost(userId, xacct, when, { dryRun: !!(opts && opts.dryRun), timeRange: w });
        if (res && res.created) created += res.created;
      } catch (e) {
        await putLog({ userId, type: "auto-post-x", accountId: xacct.accountId, status: "error", message: "x reservation create failed", detail: { error: String(e) } });
      }
    } catch (e) {
      console.warn('[warn] ensureNextDayAutoPostsForX inner failed:', String(e));
    }
  }

  return { created, skipped: false };
}

/// ========== プラットフォーム直接API（Threads） ======
// ====== GAS の実装に合わせた Threads 投稿 ======
async function postToThreads({ accessToken, oauthAccessToken, text, userIdOnPlatform, inReplyTo = undefined }: any) {
  // Delegate to shared implementation in src/lib/threads.ts to ensure consistent token selection
  return await sharedPostToThreads({ accessToken: accessToken || '', oauthAccessToken: oauthAccessToken || undefined, text, userIdOnPlatform, inReplyTo });
}

/// ========== 5分ジョブ（実投稿・返信送信・2段階投稿） ==========
// 5分ジョブ：実投稿
async function runAutoPostForAccount(acct: any, userId = DEFAULT_USER_ID, settings: any = undefined, debugMode = false) {
  if (!acct.autoPost) return { posted: 0 };
  if (acct.status && acct.status !== "active") {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, status: "skip", message: `status=${acct.status} のためスキップ` });
    return { posted: 0 };
  }

  // まず "未投稿・時刻到来" の予約を1件取得（GSI→PKフォールバック）
  // 方式B: GSIはキーだけを取得（Filterしない）→ 本体をGetItemで精査
  // Query only by GSI keys (accountId + scheduledAt) and avoid server-side FilterExpression
  // so that we don't consume the Limit with filtered-out items. We'll refine candidates
  // locally (GetItem + checks) to decide the actual posting target.
  // Prefer sparse pending-index if available
  let q;
  try {
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      IndexName: GSI_PENDING_BY_ACC_TIME,
      KeyConditionExpression: "pendingForAutoPostAccount = :acc AND scheduledAt <= :now",
      ExpressionAttributeValues: {
        ":acc": { S: acct.accountId },
        ":now": { N: String(nowSec()) },
      },
      // PendingByAccTime GSI does not necessarily project 'status' — avoid requesting it
      ProjectionExpression: "PK, SK, scheduledAt, postedAt",
      ScanIndexForward: true,
      Limit: 50
    }));
  } catch (e) {
    if (!isGsiMissing(e)) throw e;
    // fallback to legacy index
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      IndexName: GSI_SCH_BY_ACC_TIME,
      KeyConditionExpression: "accountId = :acc AND scheduledAt <= :now",
      ExpressionAttributeValues: {
        ":acc": { S: acct.accountId },
        ":now": { N: String(nowSec()) },
      },
      // Keys only でも動くように PK/SK と scheduledAt だけ取得
      ProjectionExpression: "PK, SK, scheduledAt, postedAt",
      ScanIndexForward: true, // 古い順に見る
      Limit: 50               // 上限を増やして取りこぼしを回避
    }));
  }
  
  const debugInfo: any = debugMode ? { qItemsCount: (q.Items || []).length, items: [] as any[] } : undefined;

  // If GSI returned no items, try a PK-based fallback query for observability
  if (debugMode && (!q.Items || q.Items.length === 0)) {
    try {
      const fallback = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        // PK fallback: USER#userId + begins_with SK
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "SCHEDULEDPOST#" },
          ":acc": { S: acct.accountId },
        },
        FilterExpression: "accountId = :acc",
        ProjectionExpression: "PK, SK, scheduledAt, postedAt, #st, timeRange, content, accountId",
        ExpressionAttributeNames: { "#st": "status" },
        ScanIndexForward: true,
        Limit: 50
      }));
      (debugInfo as any).fallbackCount = (fallback.Items || []).length;
      (debugInfo as any).fallbackSample = (fallback.Items || []).slice(0, 6).map(it => {
        try {
          return {
            PK: it.PK?.S,
            SK: it.SK?.S,
            scheduledAt: it.scheduledAt?.N,
            postedAt: it.postedAt?.N,
            status: it.status?.S || it["#st"]?.S || null,
            timeRange: it.timeRange?.S,
            contentEmpty: !(it.content && it.content.S && String(it.content.S).trim().length > 0),
            accountId: it.accountId?.S,
          };
        } catch (e) { return { err: String(e) }; }
      });
    } catch (e) {
      try { (debugInfo as any).fallbackError = String(e).slice(0, 500); } catch (_) { }
    }
  }

  // Collect candidate items (scheduled, not posted, not expired)
  const candidates: any[] = [];
  let iterIndex = 0;
  for (const it of (q.Items || [])) {
    const pk = getS(it.PK) || '';
    const sk = getS(it.SK) || '';
    const full = await ddb.send(new GetItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: String(pk) }, SK: { S: String(sk) } },
      ProjectionExpression: "content, postedAt, timeRange, scheduledAt, autoPostGroupId, numericPostId, #st, #type",
      ExpressionAttributeNames: { "#st": "status", "#type": "type" }
    }));
    const x = unmarshall(full.Item || {});
    const postedZero = !x.postedAt || x.postedAt === 0 || x.postedAt === "0";
    const stOK = (x.status || "") === "scheduled";
    const notExpired = !x.timeRange || (() => {
      const endJst = rangeEndOfDayJst(x.timeRange, jstFromEpoch(Number(x.scheduledAt || 0)));
      return !endJst || nowSec() <= toEpochSec(endJst);
    })();

    if (stOK && postedZero && notExpired) {
      // Exclude permanentFailure items completely from candidate set
      const permFail = !!x.permanentFailure;
      if (permFail) {
        try { await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "skip", message: "permanentFailure - excluded from candidates", detail: { scheduledAt: x.scheduledAt, timeRange: x.timeRange } }); } catch(_) {}
      } else {
        // include only non-permanent-failure candidates (deprioritization by attempts still applies)
        const attempts = Number(x.postAttempts || 0);
        candidates.push({ pk, sk, attempts, scheduledAt: Number(x.scheduledAt || 0), ...x });
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "probe", message: "candidate queued", detail: { scheduledAt: x.scheduledAt, timeRange: x.timeRange } });
      }
    if (debugMode && (debugInfo.items as any[]).length < 6) {
        (debugInfo.items as any[]).push({ idx: iterIndex, pk, sk, status: x.status, postedAt: x.postedAt, scheduledAt: x.scheduledAt, timeRange: x.timeRange, stOK, postedZero, notExpired });
      }
    } else if (stOK && postedZero && !notExpired) {
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "skip", message: `時刻範囲(${x.timeRange})を過ぎたため投稿せず失効` });
        if (debugMode) {
          if (!debugInfo.skips) debugInfo.skips = [];
          debugInfo.skips.push({ sk, reason: 'window_expired', scheduledAt: x.scheduledAt, timeRange: x.timeRange });
        }
      }
    iterIndex++;
  }

  if (!candidates || candidates.length === 0) return debugMode ? { posted: 0, debug: debugInfo } : { posted: 0 };

  // Sort candidates: prefer lower attempts, prefer newer scheduledAt for quotes
  candidates.sort((a, b) => {
    // permanentFailure last
    if (a.permFail !== b.permFail) return a.permFail ? 1 : -1;
    // fewer attempts first
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    // For quote type prefer newer scheduledAt (descending)
    if ((a.type === 'quote') && (b.type === 'quote')) return Number(b.scheduledAt || 0) - Number(a.scheduledAt || 0);
    // fallback: older scheduled first
    return Number(a.scheduledAt || 0) - Number(b.scheduledAt || 0);
  });

  // Attempt to post up to 1 quote and 1 normal per run
  let postedQuote = 0;
  let postedNormal = 0;
  const attemptPostCandidate = async (cand: any) => {
    const pk = cand.pk; const sk = cand.sk;
    let text = cand.content || '';
    // If this reservation is pool-driven and content empty, claim from PostPool (Lambda-side)
    try {
      if ((cand.type === 'pool' || String(cand.type || '').toLowerCase() === 'pool') && (!text || String(text).trim() === "")) {
        const poolType = cand.poolType || 'general';
        // Try to reuse latest failed reservation's content for this account (no new record creation)
        let reused = null;
        try {
          const prevQ = await ddb.send(new QueryCommand({
            TableName: TBL_SCHEDULED,
            IndexName: GSI_POS_BY_ACC_TIME,
            KeyConditionExpression: "accountId = :acc",
            ExpressionAttributeValues: { ":acc": { S: String(acct.accountId) } },
            ProjectionExpression: "PK,SK,content,images,scheduledAt,#st,permanentFailure",
            ExpressionAttributeNames: { "#st": "status" },
            ScanIndexForward: false,
            Limit: 50,
          }));
          const prevItems: any[] = (prevQ as any).Items || [];
          for (const it of prevItems) {
            const st = getS(it.status) || "";
            const pf = it.permanentFailure?.BOOL === true;
            const c = getS(it.content) || "";
            if (st === "failed" && !pf && c) { reused = it; break; }
          }
        } catch (e) {
          try { await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "warn", message: "reuse_lookup_failed", detail: { error: String(e) } }); } catch(_) {}
        }

        if (reused) {
          // Write reused content into current reservation (no new record creation)
          try {
            if (!(opts && opts.dryRun) && !(global as any).__TEST_CAPTURE__) {
              const updVals: any = { ":c": { S: String(getS(reused.content) || "") }, ":ts": { N: String(nowSec()) }, ":src": { S: String(getS(reused.SK) || "") } };
              const updExprParts = ["content = :c", "lastClaimedFromFailed = :src", "lastClaimedAt = :ts"];
              if (getS(reused.images)) { updExprParts.push("images = :imgs"); updVals[":imgs"] = { S: String(getS(reused.images) || "") }; }
              await ddb.send(new UpdateItemCommand({
                TableName: TBL_SCHEDULED,
                Key: { PK: { S: pk }, SK: { S: sk } },
                UpdateExpression: `SET ${updExprParts.join(', ')}`,
                ExpressionAttributeValues: updVals,
              }));
            } else {
              try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'DRYRUN_REUSE_FAILED_CONTENT', payload: { userId, accountId: acct.accountId, fromSK: String(getS(reused.SK) || '') } }); } catch(_) {}
            }
            text = String(getS(reused.content) || "");
          } catch (e) {
            try { await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "warn", message: "reuse_persist_failed", detail: { error: String(e) } }); } catch(_) {}
          }
        } else {
          // No reusable failed content found -> claim from pool
          const claimed = await claimPoolItem(userId, poolType);
          if (!claimed) {
            await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "pool_claim_failed", detail: { poolType } });
            await incrementAccountFailure(userId, acct.accountId);
            try { await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: "SET postAttempts = if_not_exists(postAttempts, :zero) + :inc, lastPostError = :err, lastPostAttemptAt = :ts", ExpressionAttributeValues: { ":zero": { N: "0" }, ":inc": { N: "1" }, ":err": { S: "pool_claim_failed" }, ":ts": { N: String(nowSec()) } } })); } catch(_) {}
            return { ok: false };
          }
          // Persist claimed content into scheduled-post so retries reuse it; pool is consumed (atomic delete in claimPoolItem)
          try {
            const updVals: any = { ":c": { S: String(claimed.content || "") }, ":ts": { N: String(nowSec()) } };
            const updExprParts = ["content = :c", "lastClaimedAt = :ts"];
            if (claimed.poolId) { updExprParts.push("claimedFromPoolId = :pid"); updVals[":pid"] = { S: String(claimed.poolId) }; }
            if (claimed.images && Array.isArray(claimed.images)) { updExprParts.push("images = :imgs"); updVals[":imgs"] = { S: JSON.stringify(claimed.images) }; }
            await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: `SET ${updExprParts.join(', ')}`, ExpressionAttributeValues: updVals }));
            text = String(claimed.content || "");
            await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "info", message: "pool_claim_ok", detail: { poolId: claimed.poolId } });
          } catch (e) {
            await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "pool_claim_persist_failed", detail: { error: String(e) } });
            await incrementAccountFailure(userId, acct.accountId);
            return { ok: false };
          }
        }
      }
    } catch (e) {
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "pool_claim_exception", detail: { error: String(e) } });
      await incrementAccountFailure(userId, acct.accountId);
      return { ok: false };
    }
    const isQuote = (cand as any).type === 'quote';
    const scheduledAtSec = Number(cand.scheduledAt || 0);

    // Skip if text empty
  if (!text) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "skip", message: "本文が未生成のためスキップ" });
      return { ok: false };
    }

    // Skip expired
    if (cand.timeRange && scheduledAtSec > 0) {
    const schDateJst = jstFromEpoch(scheduledAtSec);
      const endJst = rangeEndOfDayJst(cand.timeRange, schDateJst);
    if (endJst && nowSec() > toEpochSec(endJst)) {
      try {
          await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: "SET #st = :expired, expiredAt = :ts, expireReason = :rsn", ConditionExpression: "#st = :scheduled", ExpressionAttributeNames: { "#st": "status" }, ExpressionAttributeValues: { ":expired": { S: "expired" }, ":scheduled": { S: "scheduled" }, ":ts": { N: String(nowSec()) }, ":rsn": { S: "time-window-passed" } } }));
          await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "skip", message: `時刻範囲(${cand.timeRange})を過ぎたため投稿せず失効` });
        } catch (e) { await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "失効処理に失敗", detail: { error: String(e) } }); }
        return { ok: false };
      }
    }

    // Ensure providerUserId and token
  if (!acct.providerUserId) {
    const pid = await ensureProviderUserId(userId, acct);
      if (!pid) { await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "ThreadsのユーザーID未取得のため投稿不可" }); return { ok: false }; }
    }
    if (!acct.oauthAccessToken) { await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "ThreadsのoauthAccessToken未設定（accessTokenは使用不可）" }); return { ok: false }; }

    try {
      // perform post
      let postResult: any;
    if (isQuote) {
      const referenced = cand.numericPostId || '';
      if (!referenced) {
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "引用元の数値IDが存在しないため引用投稿をスキップ（失敗）" });
        await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: "SET postAttempts = if_not_exists(postAttempts, :zero) + :inc, lastPostError = :err, lastPostAttemptAt = :ts, permanentFailure = :t", ExpressionAttributeValues: { ":zero": { N: "0" }, ":inc": { N: "1" }, ":err": { S: "referenced_post_missing" }, ":ts": { N: String(nowSec()) }, ":t": { BOOL: true } } }));
        return { ok: false };
      }
      postResult = await sharedPostQuoteToThreads({ accessToken: acct.oauthAccessToken, oauthAccessToken: acct.oauthAccessToken, text, referencedPostId: String(referenced), userIdOnPlatform: acct.providerUserId });
    } else {
      postResult = await postToThreads({ accessToken: acct.oauthAccessToken, oauthAccessToken: acct.oauthAccessToken, text, userIdOnPlatform: acct.providerUserId });
    }

      // Save posted state
      const nowTs = nowSec();
      const updateExprParts: string[] = ["#st = :posted", "postedAt = :ts", "postId = :pid"];
      const updateValues: any = { ":posted": { S: "posted" }, ":ts": { N: String(nowTs) }, ":pid": { S: postResult.postId || "" } };
      // Ensure :scheduled is present for the ConditionExpression check
      updateValues[":scheduled"] = { S: "scheduled" };
      // Use only the published numericId (from publish response). Do not use creationId.
      // Save only the numeric ID returned by publish (publishedNumeric). No fallbacks.
      const resolvedNumericId = (postResult as any).publishedNumeric || undefined;
      // Debug: log postResult and resolvedNumericId before DB update
      try {
        console.info('[DBG auto-post] postResult', { postResult });
        console.info('[DBG auto-post] resolvedNumericId', resolvedNumericId);
        console.info('[DBG auto-post] updateExprParts(before numeric)', updateExprParts, 'updateValues(before numeric)', updateValues);
      } catch (e) { console.warn('[DBG auto-post] logging failed', e); }

      if (resolvedNumericId) {
        updateExprParts.push("numericPostId = :nid");
        updateValues[":nid"] = { S: String(resolvedNumericId) };
      }

      try {
        console.info('[DBG auto-post] updateExprParts(final)', updateExprParts, 'updateValues(final)', updateValues);
      } catch (e) { console.warn('[DBG auto-post] logging failed 2', e); }
      if (acct.secondStageContent && acct.secondStageContent.trim()) { updateExprParts.push("doublePostStatus = :waiting"); updateValues[":waiting"] = { S: "waiting" }; }
      await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: `SET ${updateExprParts.join(', ')}`, ConditionExpression: "#st = :scheduled", ExpressionAttributeNames: { "#st": "status" }, ExpressionAttributeValues: updateValues }));
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "ok", message: "自動投稿を完了", detail: { platform: "threads" } });
      return { ok: true, type: isQuote ? 'quote' : 'normal' };
    } catch (e) {
      try { await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } }, UpdateExpression: "SET postAttempts = if_not_exists(postAttempts, :zero) + :inc, lastPostError = :err, lastPostAttemptAt = :ts", ExpressionAttributeValues: { ":zero": { N: "0" }, ":inc": { N: "1" }, ":err": { S: String((e as any)?.message || String(e)).slice(0,1000) }, ":ts": { N: String(nowSec()) } } })); } catch (_) {}
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "投稿失敗", detail: { error: String(e) } });
      await incrementAccountFailure(userId, acct.accountId);
      await postDiscordLog({ userId, isError: true, content: `**[ERROR auto-post] ${acct.displayName || acct.accountId}**\n${String(e).slice(0,800)}` });
      return { ok: false };
    }
  };

  let postedCount = 0;
  for (const c of candidates) {
    if (postedQuote >= 1 && postedNormal >= 1) break;
    if ((c.type === 'quote' && postedQuote >= 1) || (c.type !== 'quote' && postedNormal >= 1)) continue;
    const res = await attemptPostCandidate(c);
    if (res.ok) {
      postedCount++;
      if (res.type === 'quote') postedQuote++; else postedNormal++;
    }
  }

  if (postedCount > 0) {
    if (debugMode) { if (!debugInfo.summary) debugInfo.summary = {}; debugInfo.summary.posted = postedCount; }
    return debugMode ? { posted: postedCount, debug: debugInfo } : { posted: postedCount };
  }

  // no candidates succeeded
  const hadWindowExpired = !!(debugInfo && Array.isArray((debugInfo as any).skips) && (debugInfo as any).skips.length > 0);
  if (hadWindowExpired) {
    if (debugMode) return { posted: 0, skipped: "window_expired", debug: debugInfo } as any;
    return { posted: 0, skipped: "window_expired" } as any;
  }
  return debugMode ? { posted: 0, debug: debugInfo } : { posted: 0 };
}

// 返信送信：Replies に未返信がある場合に送信し、成功時に replied へ更新
async function runRepliesForAccount(acct: any, userId = DEFAULT_USER_ID, settings: any = undefined) {
  if (!acct.autoReply) return { replied: 0 };
  if (acct.status && acct.status !== "active") {
    await putLog({ userId, type: "auto-reply", accountId: acct.accountId, status: "skip", message: `status=${acct.status} のためスキップ` });
    return { replied: 0 };
  }

  let res;
  try {
    res = await ddb.send(new QueryCommand({
      TableName: TBL_REPLIES,
      IndexName: GSI_REPLIES_BY_ACC,
      KeyConditionExpression: "accountId = :acc AND createdAt >= :min",
      FilterExpression: "#st = :un AND attribute_exists(replyContent) AND size(replyContent) > :z",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":acc": { S: acct.accountId },
        ":min": { N: "0" },
        ":un":  { S: "unreplied" },
        ":z":   { N: "0" }
      },
      ProjectionExpression: "PK, SK, postId, replyContent",
    }));
  } catch (e) {
    if (!isGsiMissing(e)) throw e;
    console.warn("[warn] GSI1 missing on Replies. fallback to PK Query");
    res = await ddb.send(new QueryCommand({
      TableName: TBL_REPLIES,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk":     { S: `USER#${userId}` },
        ":pfx":    { S: "REPLY#" },
        ":acc":    { S: acct.accountId },
        ":min":    { N: "0" },
        ":un":     { S: "unreplied" },
        ":z":      { N: "0" }
      },
      FilterExpression:
        "accountId = :acc AND createdAt >= :min AND #st = :un AND attribute_exists(replyContent) AND size(replyContent) > :z",
      ExpressionAttributeNames: { "#st": "status" },
      ProjectionExpression: "PK, SK, postId, replyContent",
    }));
  }

  const items = (res.Items || []);
  if (items.length === 0) return { replied: 0 };

  // Threads のユーザーIDが未取得であれば取得
  if (!acct.providerUserId) {
    const pid = await ensureProviderUserId(userId, acct);
    if (!pid) {
      await putLog({ userId, type: "auto-reply", accountId: acct.accountId, status: "skip", message: "ThreadsのユーザーID未取得のためスキップ" });
      return { replied: 0 };
    }
  }

  // postId ごとに最大2件送信
  const byPost = new Map();
  for (const it of items) {
    const pid = it.postId?.S || "";
    if (!pid) continue;
    if (!byPost.has(pid)) byPost.set(pid, []);
    byPost.get(pid).push(it);
  }

  let count = 0;
  for (const [, arr] of byPost) {
    const targets = arr.slice(0, 2);
    for (const it of targets) {
      const text = it.replyContent?.S || "";
      const externalReplyId = (it.SK?.S || "").startsWith("REPLY#")
        ? it.SK.S.substring("REPLY#".length)
        : "";
      const parentId = externalReplyId || (getS(it.postId) || "");

      try {
        const { postId: respId } = await sharedPostToThreads({
          accessToken: acct.oauthAccessToken || acct.accessToken,
          oauthAccessToken: acct.oauthAccessToken || undefined,
          text,
          userIdOnPlatform: acct.providerUserId,
          inReplyTo: parentId
        });
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_REPLIES,
          Key: { PK: { S: getS(it.PK) || '' }, SK: { S: getS(it.SK) || '' } },
          UpdateExpression: "SET #st = :replied, replyAt = :ts, responseContent = :resp",
          ConditionExpression: "#st = :unreplied",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":replied": { S: "replied" },
            ":unreplied": { S: "unreplied" },
            ":ts": { N: String(nowSec()) },
            ":resp": { S: `sent:${respId || ""}` }
          }
        }));
        count++;
      } catch (e) {
        await putLog({ userId, type: "auto-reply", accountId: acct.accountId, status: "error", message: "返信送信に失敗", detail: { error: String(e) } });        
        await postDiscordLog({
          userId,
          isError: true,
          content: `**[ERROR auto-reply] ${acct.displayName || acct.accountId}**\n${String(e).slice(0, 800)}`
        });
      }
    }
  }
  if (count > 0) {
    await putLog({ userId, type: "auto-reply", accountId: acct.accountId, status: "ok", message: `返信送信 ${count} 件` });
  }
  return { replied: count };
}

// 2段階投稿：postedAt + delay 経過、doublePostStatus != "done" のものに本文のみを返信
async function runSecondStageForAccount(acct: any, userId = DEFAULT_USER_ID, settings: any = undefined, debugMode = false) {
  if (!acct.secondStageContent) return { posted2: 0 };
  
  // アカウントに二段階投稿設定があれば実行。遅延時間は設定値またはデフォルト30分
  const delayMin = Math.max(settings?.doublePostDelayMinutes ?? 30, 1);

  const threshold = nowSec() - delayMin * 60;

  // 観測性向上: 入口ログ
  

  let q;
  try {
    // フィルタは使わず「直近最大50件のキー」を取得し、後段で条件判定する（LimitとFilterの組合せで取り逃すのを防ぐ）
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      IndexName: GSI_POS_BY_ACC_TIME,
      KeyConditionExpression: "accountId = :acc AND postedAt <= :th",
      ExpressionAttributeValues: {
        ":acc":    { S: acct.accountId },
        ":th":     { N: String(threshold) },
      },
      ProjectionExpression: "PK, SK",
      ScanIndexForward: false,
      Limit: 50
    }));
  } catch (e) {
    if (!isGsiMissing(e)) throw e;
    console.warn("[warn] GSI2 missing on ScheduledPosts. fallback to PK Query");
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk":     { S: `USER#${userId}` },
        ":pfx":    { S: "SCHEDULEDPOST#" },
        ":acc":    { S: acct.accountId },
        ":th":     { N: String(threshold) },
      },
      FilterExpression: "accountId = :acc AND postedAt <= :th",
      ProjectionExpression: "PK, SK",
      Limit: 50
    }));
  }

  // 観測性向上: クエリ結果を記録
  
  if (!q.Items || q.Items.length === 0) {
    await putLog({
      userId,
      type: "second-stage",
      accountId: acct.accountId,
      status: "noop",
      message: "対象なし",
      detail: { threshold, delayMin }
    });
    return debugMode ? { posted2: 0, debug: { reason: "no_candidate", threshold, delayMin } } : { posted2: 0 };
  }

  // 直近から本体を取得して条件判定
  let pk = "", sk = "", firstPostId = "", firstPostedAt = "";
  let found: any = null;
  const debugTried: any[] = [];
  for (const it of (q.Items || [])) {
    const kpk = getS(it.PK) || '', ksk = getS(it.SK) || '';
    const full = await ddb.send(new GetItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: kpk }, SK: { S: ksk } },
      ProjectionExpression: "postId, numericPostId, postedAt, doublePostStatus, autoPostGroupId, #st, secondStageWanted",
      ExpressionAttributeNames: { "#st": "status" }
    }));
    const f = full.Item || {};
    const st = getS(f.status) || "";
    const dp = getS(f.doublePostStatus) || "";
    const apg = getS(f.autoPostGroupId) || "";
    const pid = getS(f.postId) || "";
    const nid = getS(f.numericPostId) || "";
    const pat = getN(f.postedAt) || "";
    // secondStageWanted を尊重：存在すれば true のもののみ対象、未指定なら従来通り
    const ssw = (typeof f.secondStageWanted !== 'undefined') ? (f.secondStageWanted?.BOOL === true || String(f.secondStageWanted?.S || '').toLowerCase() === 'true') : undefined;
    // Require explicit secondStageWanted === true to be eligible.
    const ok = st === "posted" && pid && (!dp || dp !== "done") && apg.includes("自動投稿") && Number(pat || 0) <= threshold && (ssw === true);
    if (debugMode && debugTried.length < 5) debugTried.push({ ksk, st, dp, apg, pid, nid, pat, ok });
    if (ok) { found = { kpk, ksk, pid, nid, pat }; break; }
  }

  if (!found) {
    if (debugMode) return { posted2: 0, debug: { reason: "no_candidate_scan", tried: debugTried, threshold, delayMin } };
    return { posted2: 0 };
  }

  pk = found.kpk; sk = found.ksk; firstPostId = found.nid || found.pid; firstPostedAt = found.pat;

  await putLog({
    userId,
    type: "second-stage",
    accountId: acct.accountId,
    targetId: sk,
    status: "probe",
    message: "candidate found",
    detail: { firstPostId, firstPostedAt, threshold, delayMin }
  });

  // Threads のユーザーIDが未取得であれば取得
  if (!acct.providerUserId) {
    const pid = await ensureProviderUserId(userId, acct);
    if (!pid) {
      await putLog({ userId, type: "second-stage", accountId: acct.accountId, targetId: sk, status: "skip", message: "ThreadsのユーザーID未取得のためスキップ" });
      return debugMode ? { posted2: 0, debug: { reason: "no_provider_user_id", pk, sk, firstPostId } } : { posted2: 0 };
    }
  }

  try {
    const text2 = acct.secondStageContent;
    // note: second-stage posting attempt logged minimally
    try { console.info('[info] second-stage attempt', { account: acct.accountId, parent: firstPostId }); } catch (_) {}
    const { postId: pid2 } = await sharedPostToThreads({ accessToken: acct.oauthAccessToken || acct.accessToken, oauthAccessToken: acct.oauthAccessToken || undefined, text: text2, userIdOnPlatform: acct.providerUserId, inReplyTo: firstPostId });
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: pk }, SK: { S: sk } },
      UpdateExpression: "SET doublePostStatus = :done, secondStagePostId = :pid, secondStageAt = :ts",
      ConditionExpression: "attribute_not_exists(doublePostStatus) OR doublePostStatus <> :done",
      ExpressionAttributeValues: { ":done": { S: "done" }, ":pid": { S: pid2 || `DUMMY2-${crypto.randomUUID()}` }, ":ts": { N: String(nowSec()) } }
    }));
    await putLog({ userId, type: "second-stage", accountId: acct.accountId, targetId: sk, status: "ok", message: "2段階投稿を完了", detail: { secondStagePostId: pid2 } });
    return debugMode ? { posted2: 1, debug: { reason: "ok", pk, sk, firstPostId, secondStagePostId: pid2 } } : { posted2: 1 };
  } catch (e) {
    const errStr = String(e);
    await putLog({ userId, type: "second-stage", accountId: acct.accountId, targetId: sk, status: "error", message: "2段階投稿に失敗", detail: { error: errStr, parentPostId: firstPostId } });
    // Debug Discord logging removed
    if (debugMode) {
      try {
        await postDiscordMaster(`**[TEST second-stage ERROR] ${acct.displayName || acct.accountId}**\nparent=${firstPostId}\n${errStr.slice(0, 1800)}`);
      } catch {}
    }
    return debugMode ? { posted2: 0, debug: { reason: "post_error", pk, sk, firstPostId, error: errStr.slice(0,800) } } : { posted2: 0 };
  }
}

/// ========== ユーザー単位の実行ラッパー ==========
async function runHourlyJobForUser(userId: any, opts: any = {}) {
  // normalize incoming userId (strip USER# prefix if present)
  const normalizedUserId = String(userId || '').replace(/^USER#/, '');
  const settings = await getUserSettings(normalizedUserId);
  if (settings.autoPost === "inactive") {
    try {
      // マスターOFFで返信取得を含む全処理をスキップしたことを可視化
      await putLog({ userId, type: "reply-fetch", status: "skip", message: "master autoPost inactive のため全処理スキップ" });
    } catch {}
    return { userId, createdCount: 0, replyDrafts: 0, fetchedReplies: 0, skippedAccounts: 0, skipped: "master_off" };
  }
  const accounts = await getThreadsAccounts(normalizedUserId);

  // Separate counters for Threads and X to allow split reporting
  let threadsCreated = 0;
  let threadsFetchedReplies = 0;
  let threadsReplyDrafts = 0;
  let threadsSkipped = 0;
  let xCreated = 0;
  let xSkipped = 0;
  const checkedShortcodes: Array<{ sourcePostId: string; queriedPK?: string; queriedAccountId?: string }> = [];

  for (const acct of accounts) {
    // First: try creating quote reservations for accounts that opted-in
    try {
      // Hourly: create quote reservations (reservation creation only)
      const qres = await createQuoteReservationForAccount(normalizedUserId, acct, opts);
      if (qres && qres.created) threadsCreated += qres.created || 0;
      if (qres && qres.skipped) threadsSkipped += 1;
      if (qres && qres.sourcePostId) checkedShortcodes.push({ sourcePostId: String(qres.sourcePostId), queriedPK: String(qres.queriedPK || ''), queriedAccountId: String(qres.queriedAccountId || '') });
    } catch (e) {
      console.warn('[warn] createQuoteReservationForAccount failed:', String(e));
    }

    const c = await ensureNextDayAutoPosts(normalizedUserId, acct, opts);
    threadsCreated += c.created || 0;
    if (c.skipped) threadsSkipped += 1;

      // Hourly: pool-driven fallback for Threads accounts removed.
      // Pool-driven reservations are managed elsewhere; do not create a single pool fallback here.

  // NOTE: X account hourly reservations are created in a single pass after processing Threads accounts.

    try {
      if (!DISABLE_QUOTE_PROCESSING) {
        const fr = await fetchIncomingReplies(normalizedUserId, acct);
        threadsFetchedReplies += fr.fetched || 0;
        threadsReplyDrafts += fr.fetched || 0; // 取得したリプライ分だけ返信ドラフトが生成される
      } else {
        try { console.info('[info] fetchIncomingReplies skipped by DISABLE_QUOTE_PROCESSING', { userId, account: acct.accountId }); } catch(_) {}
      }
    } catch (e) {
      console.error('[error] fetchThreadsRepliesAndSave reply-fetch failed:', String(e));
      await putLog({ userId, type: "reply-fetch", accountId: acct.accountId, status: "error", message: "返信取得失敗", detail: { error: String(e) } });
      throw e;
    }

    // 短期対応: アカウントごとに少数ずつ本文生成を行う（ロック付き・limit=1）
    // NOTE: hourly should NOT perform content generation here (generation belongs to every-5min)
  }

  const urls = await getDiscordWebhooks(userId);
  const now = new Date().toISOString();
  // minor debug: totals logged at info level only
  try {
    const totalsInfo = {
      createdCount: (threadsCreated || 0) + (xCreated || 0),
      fetchedReplies: threadsFetchedReplies || 0,
      replyDrafts: threadsReplyDrafts || 0,
      skippedAccounts: (threadsSkipped || 0) + (xSkipped || 0),
    };
    console.info('[info] hourly totals', totalsInfo);
  } catch (e) {
    console.error('[error] hourly totals logging failed:', String(e));
  }
  // Hourly: also create empty reservations for X accounts (pool-driven)
  try {
    if (settings && settings.enableX) {
      const xAccounts = await getXAccounts(normalizedUserId);
      for (const xacct of xAccounts) {
        try {
          const xc = await ensureNextDayAutoPostsForX(normalizedUserId, xacct, opts);
          xCreated += xc.created || 0;
          if (xc.skipped) xSkipped += 1;
          try { console.info('[x-hourly] ensureNextDayAutoPostsForX', { userId: normalizedUserId, accountId: xacct.accountId, result: xc }); } catch(_) {}
          (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
          (global as any).__TEST_OUTPUT__.push({ tag: 'HOURLY_X_POOL_RESERVATION', payload: { accountId: xacct.accountId, result: xc } });
        } catch (e) {
          console.warn('[warn] hourly X pool reservation failed for acct', String(xacct && xacct.accountId), String(e));
        }
      }
    } else {
      try { console.info('[info] hourly X pool reservations skipped by user setting enableX=false', { userId: normalizedUserId }); } catch(_) {}
      (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
      (global as any).__TEST_OUTPUT__.push({ tag: 'HOURLY_X_POOL_SKIPPED_BY_SETTING', payload: { userId: normalizedUserId } });
    }
  } catch (e) {
    console.warn('[warn] hourly X pool reservation failed', String(e));
  }
  // Build Discord message with Threads/X separated; respect user setting enableX for user webhooks.
  try {
    const enableX = !!(settings && settings.enableX === true);
    const header = `**[定期実行レポート] ${now} (hourly)**\n`;
    const threadsLine = `Threads — 予約作成: ${threadsCreated} / 返信取得: ${threadsFetchedReplies} / 返信下書き: ${threadsReplyDrafts} / スキップ: ${threadsSkipped}`;
    const xLine = `X — 予約作成: ${xCreated} / スキップ: ${xSkipped}`;
    const totalSkips = threadsSkipped + (enableX ? xSkipped : 0);
    const combinedLine = `合計スキップ: ${totalSkips}`;
    const content = header + threadsLine + (enableX ? `\n${xLine}\n${combinedLine}` : `\n${combinedLine}`);
    await postDiscordLog({ userId, content });
  } catch (e) {
    try { console.warn('[warn] postDiscordLog (hourly) failed', String(e)); } catch(_) {}
  }
  return { userId, createdCount: threadsCreated + xCreated, fetchedReplies: threadsFetchedReplies, replyDrafts: threadsReplyDrafts, skippedAccounts: threadsSkipped + xSkipped, checkedShortcodes };
}

// (removed top-level X hourly loop - now executed inside runHourlyJobForUser)

// === 予約レコードの本文生成をアカウント単位で段階的に処理する（短期対応） ===
async function processPendingGenerationsForAccount(userId: any, acct: any, limit = 1) {
  if (!acct.autoGenerate) return { generated: 0, skipped: true, processed: [] };
  const now = nowSec();
  let generated = 0;
  const processed: Array<{ scheduledPostId: string; themeUsed: string; isQuote: boolean }> = [];
  // compute JST start of today to avoid generating for old reservations
  const nowDate = new Date();
  const utc = nowDate.getTime() + nowDate.getTimezoneOffset() * 60000;
  const jstOffset = 9 * 60; // minutes
  const jstMid = new Date(utc + jstOffset * 60000);
  jstMid.setHours(0,0,0,0);
  const todayStartSec = Math.floor(jstMid.getTime() / 1000);

  // Prefer sparse GSI (needsContentAccount + nextGenerateAt) to find candidates needing content
  try {
    
    let q;
    // fetchLimit: how many candidates to fetch from GSI/PK before sorting and applying the user-requested `limit`
    const fetchLimit = Math.max(Number(limit) * 10, 100);
    try {
      q = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        IndexName: GSI_NEEDS_BY_NEXTGEN,
        KeyConditionExpression: "needsContentAccount = :acc AND nextGenerateAt <= :now",
        ExpressionAttributeValues: { ":acc": { S: acct.accountId }, ":now": { N: String(now) } },
        ProjectionExpression: "PK, SK, content, scheduledAt, nextGenerateAt, generateAttempts, generateLockedAt",
        ScanIndexForward: true,
        Limit: fetchLimit
      }));
    } catch (e) {
      // If the sparse GSI is missing, emit notification and fall back to legacy index
      if (!isGsiMissing(e)) throw e;
      try {
        await putLog({ userId, type: 'gsi-fallback', accountId: acct.accountId, status: 'warn', message: 'NeedsContentByNextGen missing; falling back to accountId+scheduledAt query', detail: { error: String(e) } });
      } catch (_) {}
      try {
        await postDiscordLog({ userId, isError: true, content: `**[GSI FALLBACK] NeedsContentByNextGen missing for user=${userId} account=${acct.accountId}; using legacy index**` });
      } catch (_) {}
      q = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        IndexName: GSI_SCH_BY_ACC_TIME,
        KeyConditionExpression: "accountId = :acc AND scheduledAt <= :now",
        ExpressionAttributeValues: { ":acc": { S: acct.accountId }, ":now": { N: String(now) } },
        ProjectionExpression: "PK, SK, content, scheduledAt, nextGenerateAt, generateAttempts",
        ScanIndexForward: true,
        Limit: fetchLimit
      }));
    }

    const items = (q.Items || []);
    

    // Prefetch full items so we can sort by scheduledAt (oldest first)
    const candidates: any[] = [];
    for (const it of items) {
      const pk = getS(it.PK) || '';
      const sk = getS(it.SK) || '';
      try {
        const full = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } } }));
        const rec = unmarshall(full.Item || {});
        candidates.push({ pk, sk, rec });
      } catch (e) {
        
      }
    }

    // Sort by scheduledAt ascending (oldest first)
    candidates.sort((a, b) => Number(a.rec?.scheduledAt || 0) - Number(b.rec?.scheduledAt || 0));

    for (const c of candidates) {
      if (generated >= limit) break;
      const pk = c.pk; const sk = c.sk; const rec = c.rec || {};
      
      const contentEmpty = !rec.content || String(rec.content || '').trim() === '';
      
      // 定期実行は「本文が空のデータ」のみに対して生成を行う
      if (!contentEmpty) {
        
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_SKIP', payload: { accountId: acct.accountId, pk, sk, reason: 'content_exists' } }); } catch(_) {}
        continue;
      }
      const nextGen = Number(rec.nextGenerateAt || 0);
      // nextGenerateAt が将来に設定されていればスキップ（バックオフ等）
      if (nextGen > now) {
        
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_SKIP', payload: { accountId: acct.accountId, pk, sk, reason: 'nextGenerateAt_future', nextGenerateAt: nextGen, now } }); } catch(_) {}
        continue;
      }

      // 条件付きでロックを取得して二重生成を防ぐ
      const lockKey = 'generateLock';
      const lockExpireSec = 60 * 10; // ロック10分
      const expiresAt = now + lockExpireSec;
      try {
        
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: pk }, SK: { S: sk } },
          UpdateExpression: "SET #lock = :id, generateLockedAt = :ts",
          ConditionExpression: "attribute_not_exists(#lock) OR generateLockedAt < :now",
          ExpressionAttributeNames: { "#lock": lockKey },
          ExpressionAttributeValues: {
            ":id": { S: `worker:${process.env.AWS_LAMBDA_LOG_STREAM_NAME || 'lambda'}:${now}` },
            ":ts": { N: String(expiresAt) },
            ":now": { N: String(now) }
          }
        }));
        
      } catch (e) {
        
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_LOCK_FAIL', payload: { accountId: acct.accountId, pk, sk, error: String(e) } }); } catch(_) {}
        continue;
      }

      // 生成処理
      try {
        const userSettings = await getUserSettings(userId);
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_START', payload: { accountId: acct.accountId, pk, sk, settings_present: !!userSettings, settings_sample: { openaiApiKeyPresent: !!userSettings.openaiApiKey, model: userSettings.model || null } } }); } catch(_) {}
        const scheduledId = sk.replace(/^SCHEDULEDPOST#/, '');
        const themePassed = String(rec.theme || '');
        const ok = await generateAndAttachContent(userId, acct, scheduledId, themePassed, userSettings);
        if (ok) {
          generated++;
          processed.push({ scheduledPostId: scheduledId, themeUsed: themePassed, isQuote: (rec.type === 'quote') });
          try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_DONE', payload: { accountId: acct.accountId, pk, sk, generated: 1 } }); } catch(_) {}
        } else {
          try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_FAIL', payload: { accountId: acct.accountId, pk, sk } }); } catch(_) {}
          // dump full scheduled item and recent logs for debugging
          try {
            const full = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } } }));
            const item = unmarshall(full.Item || {});
            try { (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_FAIL_SCHEDULED_FULL', payload: { pk, sk, item } }); } catch(_) {}
          } catch (_) {}
          try {
            const q = await ddb.send(new QueryCommand({ TableName: TBL_LOGS, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: { ':pk': { S: pk }, ':pfx': { S: 'LOG#' } }, Limit: 10, ScanIndexForward: false }));
            const logs = (q.Items || []).map(i => unmarshall(i));
            try { (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_FAIL_RECENT_LOGS', payload: { pk, sk, logs } }); } catch(_) {}
          } catch (_) {}
        }
      } catch (e) {
        // 失敗したらリトライタイミングを後ろにずらす
        const backoff = Math.min(3600, ((rec.generateAttempts || 0) + 1) * 60);
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: pk }, SK: { S: sk } },
          UpdateExpression: "SET nextGenerateAt = :next, generateAttempts = if_not_exists(generateAttempts, :zero) + :inc REMOVE generateLock, generateLockedAt",
          ExpressionAttributeValues: { ":next": { N: String(now + backoff) }, ":inc": { N: "1" }, ":zero": { N: "0" } }
        }));
        try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'GEN_ERROR', payload: { accountId: acct.accountId, pk, sk, error: String(e), nextGenerateAt: now + backoff } }); } catch(_) {}
      }

      // 正常終了または失敗後にロックをクリア
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: pk }, SK: { S: sk } },
          UpdateExpression: "REMOVE generateLock, generateLockedAt",
        }));
      } catch (e) {
        console.error('[error] failed to clear generateLock during generation flow:', String(e));
        throw e;
      }
    }
  } catch (e) {
    console.warn('[warn] processPendingGenerationsForAccount query failed:', e);
  }

  if (generated > 0) await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'ok', message: `本文生成 ${generated} 件` });
  return { generated, processed };
}

async function runFiveMinJobForUser(userId: any, opts: any = {}) {
  const settings = await getUserSettings(userId);
  if (settings.autoPost === "inactive") {
    return { userId, totalAuto: 0, totalReply: 0, totalTwo: 0, rateSkipped: 0, skipped: "master_off" };
  }

  const accounts = await getThreadsAccounts(userId);
  // track X accounts that already had a successful auto-post in this run
  const processedXAccounts = new Set<string>();
  let totalAuto = 0, totalReply = 0, totalTwo = 0, rateSkipped = 0, totalX = 0;
  let xAutoDisabledSkipped = 0;
  const perAccount: any[] = [];

  for (const acct of accounts) {
    // Log presence of accessToken for observability (never log raw token)
    try {
      const tokenHash = acct.oauthAccessToken ? crypto.createHash("sha256").update(acct.oauthAccessToken).digest("hex").slice(0,12) : (acct.accessToken ? crypto.createHash("sha256").update(acct.accessToken).digest("hex").slice(0,12) : "");
      const tokenPresent = !!(acct.oauthAccessToken || acct.accessToken);
      console.log(`[every-5min] token-check user=${userId} account=${acct.accountId} tokenPresent=${tokenPresent} tokenHash=${tokenHash}`);
      // Persist minimal observation to ExecutionLogs for easier debugging in prod
      try { await putLog({ userId, type: 'token-check', accountId: acct.accountId, status: tokenPresent ? 'ok' : 'missing', message: tokenPresent ? 'accessToken present' : 'accessToken missing', detail: { accessTokenHash: tokenHash } }); } catch (e) { console.warn('[warn] putLog(token-check) failed:', String(e)); }
    } catch (e) {
      console.warn('[warn] token-check failed for', userId, acct.accountId, String(e));
    }

    try {
      (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
      try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_ACCOUNT_START', payload: { accountId: acct.accountId } }); } catch(_) {}
    } catch(_) {}

    const a = await runAutoPostForAccount(acct, userId, settings);
    // X のアカウントがあれば同一ユーザ内の X アカウントについても投稿を試みる
    try {
          if (settings && settings.enableX) {
            const xAccounts = await getXAccounts(userId);
            for (const xacct of xAccounts) {
            // skip if we've already posted for this X account during this run
            if (processedXAccounts.has(xacct.accountId)) {
              try { console.info('[x-run] skipping already-processed xacct', { accountId: xacct.accountId }); } catch(_) {}
              continue;
            }
            try {
              try { console.info('[x-run] invoking runAutoPostForXAccount', { userId, accountId: xacct.accountId, autoPostEnabled: !!xacct.autoPostEnabled, tokenPresent: !!(xacct.oauthAccessToken || xacct.accessToken) }); } catch(_) {}
              // detailed sanitized account log for debugging query params
              try {
                const safeXacct: any = { ...xacct };
                // redact sensitive token fields
                if (safeXacct.oauthAccessToken) safeXacct.oauthAccessToken = '[REDACTED]';
                if (safeXacct.accessToken) safeXacct.accessToken = '[REDACTED]';
                if (safeXacct.refreshToken) safeXacct.refreshToken = '[REDACTED]';
                if (safeXacct.oauthRefreshToken) safeXacct.oauthRefreshToken = '[REDACTED]';
              try { console.info('[x-run] invoking runAutoPostForXAccount', { userId, accountId: xacct.accountId }); } catch(_) {}
              } catch (_) {}
              // X posting logic: prefer pool-based posting (postFromPoolForAccount) implemented in post-to-x
              const xmod = await import('./post-to-x');
              try {
                // Skip accounts where auto-posting is disabled
                if (!xacct.autoPostEnabled) {
                  xAutoDisabledSkipped++;
                  try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_X_ACCOUNT_AUTOPOST_DISABLED', payload: { accountId: xacct.accountId } }); } catch(_) {}
                  continue;
                }
                const dryRun = !!(opts && opts.dryRun) || Boolean((global as any).__TEST_CAPTURE__);
                // First: try to post from existing X scheduled reservations (reservation-priority)
                try {
                  let scheduledResult: any = { posted: 0, debug: {} };
                  if (!dryRun) {
                    try {
                      const rs = await xmod.runAutoPostForXAccount(xacct, userId);
                      scheduledResult = rs || scheduledResult;
                    } catch (e) {
                      try { console.warn('[warn] runAutoPostForXAccount failed', { userId, accountId: xacct.accountId, err: String(e) }); } catch(_) {}
                    }
                  } else {
                    // In dryRun we do not execute real scheduled posting (avoid API calls); emit observation
                    try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_X_SCHEDULED_DRYRUN_SKIP', payload: { accountId: xacct.accountId } }); } catch(_) {}
                  }
                  // If scheduled posting happened, count and continue
                  if (scheduledResult && Number(scheduledResult.posted || 0) > 0) {
                    totalX += Number(scheduledResult.posted || 0);
                    processedXAccounts.add(xacct.accountId);
                    try { (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || []; (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_X_SCHEDULED_POST_RESULT', payload: { accountId: xacct.accountId, result: scheduledResult } }); } catch(_) {}
                    continue;
                  }
                } catch (_) {}
                // No pool fallback here — per spec, 5min must not create or consume pool items.
              } catch (e) { console.warn('[warn] post-from-pool failed', e); }
            } catch (e) { console.warn('[warn] post-to-x import or run failed', e); }
            }
          } else {
            try { console.info('[info] every-5min X posting skipped by user setting enableX=false', { userId }); } catch(_) {}
            (global as any).__TEST_OUTPUT__ = (global as any).__TEST_OUTPUT__ || [];
            (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_X_SKIPPED_BY_SETTING', payload: { userId } });
          }
        } catch (e) { console.warn('[warn] getXAccounts failed', e); }
    try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_AUTO_POST_RESULT', payload: { accountId: acct.accountId, result: a } }); } catch(_) {}

    const r = await runRepliesForAccount(acct, userId, settings);
    try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_REPLY_RESULT', payload: { accountId: acct.accountId, result: r } }); } catch(_) {}

    const t = await runSecondStageForAccount(acct, userId, settings, true);
    try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_SECOND_STAGE_RESULT', payload: { accountId: acct.accountId, result: t } }); } catch(_) {}

    // 短期対応: 5分ジョブでも本文生成を少数処理する（安全策）
    try {
      const genRes = await processPendingGenerationsForAccount(userId, acct, 1);
      try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_GENERATION_RESULT', payload: { accountId: acct.accountId, result: genRes } }); } catch(_) {}
      if (genRes && genRes.generated) {
        // 観測ログ用記録
      }
    } catch (e) {
      console.warn('[warn] processPendingGenerationsForAccount failed (5min):', e);
    }

    totalAuto += a.posted || 0;
    totalReply += r.replied || 0;
    totalTwo += t.posted2 || 0;
    if (perAccount.length < 6) {
      perAccount.push({
        accountId: acct.accountId,
        a: a.posted || 0,
        r: r.replied || 0,
        t: t.posted2 || 0,
        reason: (t as any).debug?.reason || "-"
      });
    }
    try { (global as any).__TEST_OUTPUT__.push({ tag: 'RUN5_ACCOUNT_DONE', payload: { accountId: acct.accountId, summary: perAccount[perAccount.length-1] } }); } catch(_) {}

    if (a.skipped === "window_expired") rateSkipped++;
    // 二段階投稿削除のスケジュールがある場合、期限切れのものを処理
    try {
      if (settings.doublePostDelete) {
        await performScheduledDeletesForAccount(acct, userId, settings);
      }
    } catch (e) {
      console.warn("[warn] performScheduledDeletesForAccount failed:", e);
    }
  }

  const urls = await getDiscordWebhooks(userId);
  const now = new Date().toISOString();
  let metrics = formatNonZeroLine([
    { label: "自動投稿", value: totalAuto },
    { label: "リプ返信", value: totalReply },
    { label: "2段階投稿", value: totalTwo },
    { label: "失効(rate-limit)", value: rateSkipped },
  ], "every-5min");
  // include X posted count in the metrics if present
  // If the main metrics indicate "実行なし" then do not append X-only info; "実行なし" should be sole message.
  if ((totalX || xAutoDisabledSkipped) && metrics !== "every-5min：実行なし") {
    try {
      const parts: string[] = [];
      if (totalX) parts.push(`X投稿: ${totalX}`);
      if (xAutoDisabledSkipped) parts.push(`X自動投稿OFF: ${xAutoDisabledSkipped}`);
      metrics += ` / ${parts.join(' / ')}`;
    } catch(_) {}
  }
  const content = metrics === "every-5min：実行なし" ? metrics : `**[定期実行レポート] ${now} (every-5min)**\n${metrics}`;
  await postDiscordLog({ userId, content });
  return { userId, totalAuto, totalReply, totalTwo, totalX, rateSkipped };
}

// 指定アカウントの予約から deleteScheduledAt が過ぎているものを削除する処理
async function performScheduledDeletesForAccount(acct: any, userId: any, settings: any) {
  try {
    const now = nowSec();
    const q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      IndexName: GSI_POS_BY_ACC_TIME,
      KeyConditionExpression: "accountId = :acc AND postedAt <= :th",
      ExpressionAttributeValues: { ":acc": { S: acct.accountId }, ":th": { N: String(now) } },
      // include secondStageAt and deleteOnSecondStage flag (we no longer rely on fixed deleteScheduledAt)
      ProjectionExpression: "PK, SK, postId, secondStagePostId, secondStageAt, deleteOnSecondStage, deleteParentAfter, #st",
      ExpressionAttributeNames: { "#st": "status" }
    }));

    for (const it of (q.Items || [])) {
      const secondAt = Number(getN(it.secondStageAt) || 0);
      if (!secondAt) continue; // nothing to base delete timing on
      // determine whether deletion is enabled for this reservation
      const resDeleteFlag = it.deleteOnSecondStage?.BOOL === true;
      const globalDeleteFlag = !!(settings && settings.doublePostDelete);
      let effectiveDeleteFlag = resDeleteFlag || globalDeleteFlag;
      // track which source enabled deletion for observability
      let flagSource: string | null = null;
      if (resDeleteFlag) flagSource = 'explicit';
      else if (globalDeleteFlag) flagSource = 'userSetting';
      // If not enabled explicitly, try to infer from auto-post-group slot settings (match by timeRange)
      if (!effectiveDeleteFlag) {
        const timeRange = getS(it.timeRange) || "";
        if (timeRange) {
          try {
            const slotsQ = await ddb.send(new QueryCommand({
              TableName: TBL_GROUPS,
              KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
              ExpressionAttributeValues: { ":pk": { S: `USER#${userId}` }, ":pfx": { S: `GROUPITEM#` } },
              ProjectionExpression: "timeRange, secondStageWanted"
            }));
            for (const s of (slotsQ.Items || [])) {
              const slotTr = getS(s.timeRange) || "";
              const slotSecond = s.secondStageWanted?.BOOL === true;
              if (slotSecond && slotTr === timeRange) {
                effectiveDeleteFlag = true;
                flagSource = 'slotInference';
                break;
              }
            }
          } catch (e) {
            console.warn("[warn] failed to load slots for delete inference:", String(e));
          }
        }
      }
      if (!effectiveDeleteFlag) {
        // nothing to do for this item
        continue;
      }
      // compute delay (minutes) from settings, default to 0
      const delayMin = Number(settings?.doublePostDeleteDelay || process.env.DOUBLE_POST_DELETE_DELAY || 0);
      const threshold = secondAt + Math.floor(delayMin * 60);
      if (threshold > now) continue;
      const pk = getS(it.PK) || '', sk = getS(it.SK) || '';
      const postId = getS(it.postId) || "";
      const secondId = getS(it.secondStagePostId) || "";
      const deleteParent = it.deleteParentAfter?.BOOL === true;
      // ログ重複防止フラグは try の外で宣言しておく（catch でも参照するため）
      let _logSaved = false;

      // 削除対象を判定してThreads APIで削除を試みる（投稿一括削除と同じ共通ユーティリティを使用）
        try {
        // トークンハッシュを作成（ログにそのままトークンを出さない）
        const tokenHash = acct.oauthAccessToken ? crypto.createHash("sha256").update(acct.oauthAccessToken).digest("hex").slice(0, 12) : (acct.accessToken ? crypto.createHash("sha256").update(acct.accessToken).digest("hex").slice(0, 12) : "");
        // 重複ログ挿入防止フラグ（既に上で宣言済み）

        // フォールバック: acct に token が無ければエラー扱い（必要なら getTokenForAccount を呼ぶ実装へ拡張可能）
        const tokenToUse = acct.oauthAccessToken || acct.accessToken || '';
        let deleteResult: any = null;
        if (!tokenToUse) {
          deleteResult = { ok: false, status: 0, body: 'no_token_available' };
        } else {
          // 削除ターゲットを決める（親投稿 or 二段階投稿）
          try {
            if (deleteParent && postId) {
              await deleteThreadsPostWithToken({ postId, token: tokenToUse });
              deleteResult = { ok: true, status: 200, body: 'deleted' };
            } else if (!deleteParent && secondId) {
              await deleteThreadsPostWithToken({ postId: secondId, token: tokenToUse });
              deleteResult = { ok: true, status: 200, body: 'deleted' };
            } else {
              deleteResult = { ok: false, status: 0, body: 'no_delete_target' };
            }
          } catch (err: any) {
            deleteResult = { ok: false, status: err?.status || 0, body: String(err?.message || err) };
          }
        }

        // Delete result must be checked
        if (!deleteResult || !deleteResult.ok) {
          // 保存用だけputLogして上位catchへ投げる
          await putLog({ userId, type: "second-stage-delete", accountId: acct.accountId, targetId: sk, status: "error", message: "二段階投稿削除に失敗(HTTP)", detail: { whichFlagUsed: flagSource || 'unknown', deleteTarget: deleteParent ? 'parent' : 'second-stage', postId: postId || secondId || '', statusCode: deleteResult?.status || 0, bodySnippet: (deleteResult?.body || '').slice(0, 1000), accessTokenHash: tokenHash } });
          _logSaved = true;
          throw new Error(`threads delete failed: ${deleteResult?.status} ${deleteResult?.body}`);
        }

        // 成功したら予約レコードに削除フラグと削除日時をセット
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: pk }, SK: { S: sk } },
          UpdateExpression: "SET isDeleted = :t, deletedAt = :ts",
          ExpressionAttributeValues: { ":t": { BOOL: true }, ":ts": { N: String(now) } }
        }));

        await putLog({ userId, type: "second-stage-delete", accountId: acct.accountId, targetId: sk, status: "ok", message: "二段階投稿削除を実行", detail: { whichFlagUsed: flagSource || 'unknown', deleteTarget: deleteParent ? 'parent' : 'second-stage', postId: postId || secondId || '', statusCode: deleteResult.status, bodySnippet: (deleteResult.body || '').slice(0, 1000), accessTokenHash: tokenHash } });
      } catch (e) {
        // 二段階削除で既にエラーログを残していれば重複しないようにする
        try {
          if (!(typeof _logSaved === 'boolean' && _logSaved)) {
            await putLog({ userId, type: "second-stage-delete", accountId: acct.accountId, targetId: sk, status: "error", message: "二段階投稿削除に失敗", detail: { error: String(e), whichFlagUsed: flagSource || 'unknown', deleteTarget: deleteParent ? 'parent' : 'second-stage', postId: postId || '', secondId: secondId || '' } });
          }
        } catch (_) {}
      }
    }

    // If GSI returned candidates but none were processed (all skipped), try a limited PK fallback
    try {
        const hadGsiCandidates = (q.Items || []).length > 0;
      // Ensure local variables used in PK fallback are defined
      // (generated/limit are normally in scope in the original function; provide safe defaults here)
      let _fallback_generated = 0;
      const _fallback_limit = 1;
      if (hadGsiCandidates && _fallback_generated === 0) {
        try {
          await putLog({ userId, type: 'gsi-fallback-run', accountId: acct.accountId, status: 'warn', message: 'GSI candidates skipped; running PK fallback' });
        } catch (_) {}
        try { await postDiscordLog({ userId, isError: true, content: `**[FALLBACK] GSI candidates skipped for user=${userId} account=${acct.accountId}; running PK fallback**` }); } catch (_) {}

    const fb = await ddb.send(new QueryCommand({
          TableName: TBL_SCHEDULED,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
          ExpressionAttributeValues: {
            ":pk": { S: `USER#${userId}` },
            ":pfx": { S: "SCHEDULEDPOST#" },
            ":acc": { S: acct.accountId },
        ":scheduled": { S: "scheduled" },
            ":now": { N: String(now) },
            ":f": { BOOL: false }
          },
          FilterExpression: "accountId = :acc AND (attribute_not_exists(#st) OR #st = :scheduled) AND (attribute_not_exists(isDeleted) OR isDeleted = :f) AND scheduledAt <= :now",
          ExpressionAttributeNames: { "#st": "status" },
          ProjectionExpression: "PK, SK, content, scheduledAt, nextGenerateAt, generateAttempts",
          ScanIndexForward: true,
          Limit: 50
        }));

        const fbItems = (fb.Items || []);
        
          for (const fit of fbItems) {
          if (_fallback_generated >= _fallback_limit) break;
          const fpk = getS(fit.PK) || ''; const fsk = getS(fit.SK) || '';
          
          const full = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: fpk }, SK: { S: fsk } } }));
          const rec = unmarshall(full.Item || {});
          const contentEmpty = !rec.content || String(rec.content || '').trim() === '';
          const nextGen = Number(rec.nextGenerateAt || 0);
          if (!contentEmpty) { /* debug removed */ continue; }
          if (nextGen > now) { /* debug removed */ continue; }
          // attempt lock
          try {
            await ddb.send(new UpdateItemCommand({
              TableName: TBL_SCHEDULED,
              Key: { PK: { S: fpk }, SK: { S: fsk } },
              UpdateExpression: "SET #lock = :id, generateLockedAt = :ts",
              ConditionExpression: "attribute_not_exists(#lock) OR generateLockedAt < :now",
              ExpressionAttributeNames: { "#lock": 'generateLock' },
              ExpressionAttributeValues: { ":id": { S: `worker:${process.env.AWS_LAMBDA_LOG_STREAM_NAME || 'lambda'}:${now}` }, ":ts": { N: String(now + 600) }, ":now": { N: String(now) } }
            }));
          } catch (e) {
            
            continue;
          }

          try {
            await generateAndAttachContent(userId, acct, fsk.replace(/^SCHEDULEDPOST#/, ''), rec.theme || '', await getUserSettings(userId));
            _fallback_generated++;
            
          } catch (e) {
            
          }
          try { await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: fpk }, SK: { S: fsk } }, UpdateExpression: "REMOVE generateLock, generateLockedAt" })); } catch(e) { console.error('[error] fallback clear generateLock failed:', String(e)); throw e; }
        }
      }
    } catch (e) { console.warn('[gen] fallback error', String(e)); }
  } catch (e) {
    console.warn("[warn] performScheduledDeletesForAccount error:", e);
  }
}

// 指定ユーザーの予約投稿で、scheduledAt が RETENTION_DAYS 前より古い未投稿のものを物理削除する
async function pruneOldScheduledPosts(userId: any) {
  try {
    // Ensure AppConfig loaded and read RETENTION_DAYS
    try { await config.loadConfig(); } catch(_) {}
    const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || '7') || 7;
    // ExecutionLogs normal prune should wait one extra day to avoid racing with TTL
    const execPruneDays = Number(config.getConfigValue('EXECUTION_LOGS_PRUNE_DELAY_DAYS') || String(retentionDays + 1)) || (retentionDays + 1);
    const thresholdSec = Math.floor(Date.now() / 1000) - (execPruneDays * 24 * 60 * 60);
    // Use GSI if available for account-based queries, otherwise scan PK
    let lastKey: any = undefined;
    let totalDeleted = 0;
    // Per-Threads-account deletion limit to avoid large single-run deletes
    try { await config.loadConfig(); } catch(_) {}
    const perAccountLimit = Number(config.getConfigValue('PER_ACCOUNT_PRUNE_LIMIT') || process.env.PER_ACCOUNT_PRUNE_LIMIT || '20') || 20;
    // track deletes per Threads accountId (accountId field inside scheduled items)
    const deletedByAccount: Record<string, number> = {};
    do {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: { 
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "SCHEDULEDPOST#" },
        },
        // include accountId so we can enforce per-Threads-account caps
        ProjectionExpression: "PK, SK, scheduledAt, status, isDeleted, accountId",
        Limit: 1000,
        ExclusiveStartKey: lastKey,
      }));

      for (const it of (q.Items || [])) {
        try {
          const scheduledAt = normalizeEpochSec(getN(it.scheduledAt) || 0);
          const postedAt = normalizeEpochSec(getN(it.postedAt) || 0);
          // Defer to postedAt when present (posted items age by postedAt), otherwise use scheduledAt
          const compareAt = postedAt > 0 ? postedAt : scheduledAt;
          if (!compareAt) continue;
          if (compareAt <= thresholdSec) {
            const acctId = getS(it.accountId) || "__unknown__";
            const cur = deletedByAccount[acctId] || 0;
            if (cur >= perAccountLimit) {
              // reached cap for this Threads account
              continue;
            }
            await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
            deletedByAccount[acctId] = cur + 1;
          }
        } catch (e) {
          console.warn("[warn] prune delete failed for item", e);
        }
      }

      // If every seen account has reached cap, we can stop early. This is a heuristic — if new accounts may appear later, the loop continues.
      const allReached = Object.values(deletedByAccount).every(v => v >= perAccountLimit) && Object.keys(deletedByAccount).length > 0;
      if (allReached) {
        break;
      }

      lastKey = q.LastEvaluatedKey;
    } while (lastKey);

    if (totalDeleted > 0) {
      await putLog({ userId, type: "prune", status: "info", message: `古い予約投稿 ${totalDeleted} 件を削除しました` });
    }
    return totalDeleted;
  } catch (e) {
    console.warn("[warn] pruneOldScheduledPosts failed:", e);
    throw e;
  }
}

// X scheduled posts prune: delete XScheduledPosts for userId using same retention logic as Threads scheduled posts
async function pruneOldXScheduledPosts(userId: any) {
  try {
    try { await config.loadConfig(); } catch(_) {}
    const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || '7') || 7;
    const thresholdSec = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
    let lastKey: any = undefined;
    let totalDeleted = 0;
    const perAccountLimit = Number(config.getConfigValue('PER_ACCOUNT_PRUNE_LIMIT') || process.env.PER_ACCOUNT_PRUNE_LIMIT || '20') || 20;
    const deletedByAccount: Record<string, number> = {};
    const TBL_X_SCHEDULED_LOCAL = config.getConfigValue('TBL_X_SCHEDULED') || process.env.TBL_X_SCHEDULED || 'XScheduledPosts';
    do {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_X_SCHEDULED_LOCAL,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' } },
        ProjectionExpression: 'PK,SK,scheduledAt,postedAt,accountId',
        Limit: 1000,
        ExclusiveStartKey: lastKey,
      }));

      for (const it of (q.Items || [])) {
        try {
          const scheduledAt = normalizeEpochSec(getN(it.scheduledAt) || 0);
          const postedAt = normalizeEpochSec(getN(it.postedAt) || 0);
          const compareAt = postedAt > 0 ? postedAt : scheduledAt;
          if (!compareAt) continue;
          if (compareAt <= thresholdSec) {
            const acctId = getS(it.accountId) || '__unknown__';
            const cur = deletedByAccount[acctId] || 0;
            if (cur >= perAccountLimit) continue;
            await ddb.send(new DeleteItemCommand({ TableName: TBL_X_SCHEDULED_LOCAL, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
            deletedByAccount[acctId] = cur + 1;
          }
        } catch (e) {
          console.warn('[warn] prune X scheduled delete failed for item', e);
        }
      }

      const allReached = Object.values(deletedByAccount).every(v => v >= perAccountLimit) && Object.keys(deletedByAccount).length > 0;
      if (allReached) break;
      lastKey = q.LastEvaluatedKey;
    } while (lastKey);

    if (totalDeleted > 0) {
      await putLog({ userId, type: 'prune', status: 'info', message: `古い X 予約投稿 ${totalDeleted} 件を削除しました` });
    }
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOldXScheduledPosts failed:', e);
    throw e;
  }
}

async function pruneOldXScheduledPostsAll() {
  try {
    const userIds = await getActiveUserIds();
    let totalDeleted = 0;
    for (const uid of userIds) {
      const c = await pruneOldXScheduledPosts(uid);
      totalDeleted += Number(c || 0);
    }
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOldXScheduledPostsAll failed:', e);
    throw e;
  }
}

// 指定ユーザーの実行ログ（ExecutionLogs）で、createdAt が RETENTION_DAYS 前より古いものを削除する
async function pruneOldExecutionLogs(userId: any) {
  try {
    try { await config.loadConfig(); } catch(_) {}
    const execPruneDays = await resolveExecutionPruneDays();
    const thresholdSec = Math.floor(Date.now() / 1000) - (execPruneDays * 24 * 60 * 60);
    const perUserLogLimit = Number(config.getConfigValue('EXECUTION_LOGS_PRUNE_LIMIT') || process.env.EXECUTION_LOGS_PRUNE_LIMIT || '1000') || 1000;
    let lastKey: any = undefined;
    let totalDeleted = 0;
    do {
      const s = await ddb.send(new ScanCommand({ TableName: TBL_LOGS, ProjectionExpression: 'PK,SK,createdAt', ExclusiveStartKey: lastKey, Limit: 1000 }));
      for (const it of (s.Items || [])) {
        try {
          const createdAt = normalizeEpochSec(getN(it.createdAt) || 0);
          if (createdAt && createdAt <= thresholdSec) {
            await ddb.send(new DeleteItemCommand({ TableName: TBL_LOGS, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
            if (totalDeleted >= perUserLogLimit) break;
          }
        } catch (e) {
          console.warn('[warn] prune log delete failed for item', e);
        }
      }
      lastKey = (s as any).LastEvaluatedKey;
    } while (lastKey);

    if (totalDeleted > 0) {
      await putLog({ userId, type: "prune", status: "info", message: `古い実行ログ ${totalDeleted} 件を削除しました` });
    }
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOldExecutionLogs failed:', e);
    throw e;
  }
}

// 削除候補の件数だけを数える dry-run 用関数（ExecutionLogs）
async function countPruneExecutionLogs(userId: any) {
  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    let lastKey: any = undefined;
    let totalCandidates = 0;
    do {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_LOGS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "LOG#" },
        },
        ProjectionExpression: "createdAt",
        Limit: 1000,
        ExclusiveStartKey: lastKey,
      }));

      for (const it of (q.Items || [])) {
        try {
          const createdAt = Number(it.createdAt?.N || 0);
          if (createdAt && createdAt <= sevenDaysAgo) totalCandidates++;
        } catch (_) { /* continue */ }
      }

      lastKey = q.LastEvaluatedKey;
    } while (lastKey);

    return totalCandidates;
  } catch (e) {
    console.warn('[warn] countPruneExecutionLogs failed:', e);
    throw e;
  }
}

// Full-table prune helper: iterate all users and run pruneOldExecutionLogs
async function pruneOldExecutionLogsAll() {
  try {
    const userIds = await getActiveUserIds();
    let totalDeleted = 0;
    for (const uid of userIds) {
      const c = await pruneOldExecutionLogs(uid);
      totalDeleted += Number(c || 0);
    }
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOldExecutionLogsAll failed:', e);
    throw e;
  }
}

// Scan full ExecutionLogs table and delete items whose PK is not user-scoped (do not start with 'USER#')
// Uses the same retention logic (EXECUTION_LOGS_PRUNE_DELAY_DAYS) so TTL has time to run first.
async function pruneOrphanExecutionLogsAll() {
  try {
    try { await config.loadConfig(); } catch(_) {}
    // For scheduled posts user-scoped prune, use RETENTION_DAYS (no +1)
    const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || '7') || 7;
    const thresholdSec = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
    const orphanLimit = Number(config.getConfigValue('ORPHAN_EXEC_LOGS_PRUNE_LIMIT') || process.env.ORPHAN_EXEC_LOGS_PRUNE_LIMIT || '10000') || 10000;

    let lastKey: any = undefined;
    let totalDeleted = 0;
    do {
      const s = await ddb.send(new ScanCommand({ TableName: TBL_LOGS, ProjectionExpression: 'PK,SK,createdAt', ExclusiveStartKey: lastKey, Limit: 1000 }));
      const its = (s as any).Items || [];
      for (const it of its) {
        try {
          const pk = getS(it.PK) || '';
          // skip user-scoped logs
          if (pk && pk.startsWith('USER#')) continue;
          const createdAt = Number(it.createdAt?.N || 0);
          if (createdAt && createdAt <= thresholdSec) {
            await ddb.send(new DeleteItemCommand({ TableName: TBL_LOGS, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
            if (totalDeleted >= orphanLimit) break;
          }
        } catch (e) {
          console.warn('[warn] prune orphan log delete failed for item', e);
        }
      }
      lastKey = (s as any).LastEvaluatedKey;
      if (totalDeleted >= orphanLimit) break;
    } while (lastKey);

    if (totalDeleted > 0) {
      await putLog({ type: 'prune', status: 'info', message: `古いオーファン実行ログ ${totalDeleted} 件を削除しました` });
    }
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOrphanExecutionLogsAll failed:', e);
    throw e;
  }
}

// 指定ユーザーのRepliesを削除する（RETENTION_DAYS を参照、物理削除のみ）
async function pruneOldReplies(userId: any) {
  try {
    try { await config.loadConfig(); } catch(_) {}
    const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || '7') || 7;
    const thresholdSec = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
    // Convert to full-table scan by createdAt to support user-agnostic pruning
    let lastKey: any = undefined;
    let totalDeleted = 0;
    do {
      const s = await ddb.send(new ScanCommand({ TableName: TBL_REPLIES, ProjectionExpression: 'PK,SK,createdAt', ExclusiveStartKey: lastKey, Limit: 1000 }));
      for (const it of (s.Items || [])) {
        try {
          const createdAt = normalizeEpochSec(getN(it.createdAt) || 0);
          if (createdAt && createdAt <= thresholdSec) {
            await ddb.send(new DeleteItemCommand({ TableName: TBL_REPLIES, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
          }
        } catch (e) {
          console.warn('[warn] prune reply delete failed for item', e);
        }
      }
      lastKey = (s as any).LastEvaluatedKey;
    } while (lastKey);

    if (totalDeleted > 0) {
      await putLog({ userId, type: "prune", status: "info", message: `古いReplies ${totalDeleted} 件を削除しました` });
    }
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOldReplies failed:', e);
    throw e;
  }
}

// 削除候補の件数だけを数える dry-run 用関数
async function countPruneCandidates(userId: any) {
  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    let lastKey: any = undefined;
    let totalCandidates = 0;
    let totalScanned = 0;
    do {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: { 
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "SCHEDULEDPOST#" },
        },
        ProjectionExpression: "scheduledAt, status, isDeleted",
        Limit: 1000,
        ExclusiveStartKey: lastKey,
      }));

      // Emit debug for first N items to help troubleshooting
      const dbgItems = (q.Items || []).slice(0, 20).map((it: any) => ({
        PK: undefined,
        SK: undefined,
        scheduledAtRaw: it.scheduledAt?.N || null,
        scheduledAtNorm: normalizeEpochSec(getN(it.scheduledAt) || 0),
        status: it.status?.S || null,
        isDeleted: typeof it.isDeleted !== 'undefined' ? it.isDeleted?.BOOL === true : null,
      }));
      try { /* debug removed */ } catch (_) {}

      for (const it of (q.Items || [])) {
        try {
          const scheduledAt = normalizeEpochSec(getN(it.scheduledAt) || 0);
          totalScanned++;
          // NOTE: per request, do not filter by status or isDeleted — count purely by scheduledAt age
          if (!scheduledAt) continue;
          if (scheduledAt <= sevenDaysAgo) totalCandidates++;
        } catch (e) {
          // continue
        }
      }

      lastKey = q.LastEvaluatedKey;
    } while (lastKey);

    return { candidates: totalCandidates, scanned: totalScanned };
  } catch (e) {
    console.warn("[warn] countPruneCandidates failed:", e);
    throw e;
  }
}

// Count ALL scheduled posts in the table (pre-filter total)
async function countAllScheduledPosts() {
  try {
    let lastKey: any = undefined;
    let total = 0;
    do {
      const q = await ddb.send(new ScanCommand({
        TableName: TBL_SCHEDULED,
        ProjectionExpression: "PK",
        ExclusiveStartKey: lastKey,
        Limit: 1000,
      }));
      total += (q.Count || 0);
      lastKey = q.LastEvaluatedKey;
    } while (lastKey);
    return total;
  } catch (e) {
    console.warn('[warn] countAllScheduledPosts failed:', e);
    throw e;
  }
}

// Count all items in ExecutionLogs table
async function countAllExecutionLogs() {
  try {
    let lastKey: any = undefined;
    let total = 0;
    do {
      const q = await ddb.send(new ScanCommand({ TableName: TBL_LOGS, ProjectionExpression: 'PK', ExclusiveStartKey: lastKey, Limit: 1000 }));
      total += (q.Count || 0);
      lastKey = q.LastEvaluatedKey;
    } while (lastKey);
    return total;
  } catch (e) {
    console.warn('[warn] countAllExecutionLogs failed:', e);
    throw e;
  }
}

// Full-table prune helper: iterate all users and run pruneOldScheduledPosts
async function pruneOldScheduledPostsAll() {
  try {
    // Full-table prune using Scan so we can evaluate scheduledAt/postedAt without per-user queries
    let lastKey: any = undefined;
    let totalDeleted = 0;
    // Build set of queued accountIds to exclude
    await config.loadConfig();
    const dqTable = config.getConfigValue('TBL_DELETION_QUEUE') || process.env.TBL_DELETION_QUEUE || 'DeletionQueue';
    const queued = new Set<string>();
    try {
      let lk: any = undefined;
      do {
        const s = await ddb.send(new ScanCommand({ TableName: dqTable, ProjectionExpression: 'accountId', ExclusiveStartKey: lk, Limit: 1000 }));
        for (const it of (s as any).Items || []) {
          const aid = getS(it.accountId);
          if (aid) queued.add(aid);
        }
        lk = (s as any).LastEvaluatedKey;
      } while (lk);
    } catch (e) {
      // If deletion queue not accessible, proceed but log
      try { console.warn('[warn] could not scan DeletionQueue, proceeding without exclusions', String(e)); } catch(_) {}
    }

    do {
      const s = await ddb.send(new ScanCommand({ TableName: TBL_SCHEDULED, ProjectionExpression: 'PK,SK,scheduledAt,postedAt,accountId,type', ExclusiveStartKey: lastKey, Limit: 1000 }));
      for (const it of (s.Items || [])) {
        try {
          const acctId = getS(it.accountId) || '';
          if (acctId && queued.has(acctId)) continue; // skip queued accounts
          const scheduledAt = normalizeEpochSec(getN(it.scheduledAt) || 0);
          const postedAt = normalizeEpochSec(getN(it.postedAt) || 0);
          const compareAt = postedAt > 0 ? postedAt : scheduledAt;
          if (!compareAt) continue;
          const retentionDays = Number(config.getConfigValue('RETENTION_DAYS') || '7') || 7;
          const thresholdSec = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
          if (compareAt <= thresholdSec) {
            await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
          }
        } catch (e) {
          console.warn('[warn] prune scheduled delete failed for item', e);
        }
      }
      lastKey = (s as any).LastEvaluatedKey;
    } while (lastKey);
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOldScheduledPostsAll failed:', e);
    throw e;
  }
}

// Full-table prune for UsageCounters using updatedAt
async function pruneOldUsageCountersAll() {
  try {
    await config.loadConfig();
    const retentionDays = Number(config.getConfigValue('RETENTION_DAYS_LOGS') || '20') || 20;
    const thresholdSec = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
    // collect keys to delete
    const keys: Array<{ PK: any; SK: any }> = [];
    let lastKey: any = undefined;
    do {
      const s = await ddb.send(new ScanCommand({ TableName: TBL_USAGE, ProjectionExpression: 'PK,SK,updatedAt', ExclusiveStartKey: lastKey, Limit: 1000 }));
      for (const it of (s.Items || [])) {
        try {
          const updatedAt = normalizeEpochSec(getN(it.updatedAt) || 0);
          if (updatedAt && updatedAt <= thresholdSec) {
            keys.push({ PK: it.PK, SK: it.SK });
          }
        } catch (e) {
          console.warn('[warn] prune usage item inspect failed', e);
        }
      }
      lastKey = (s as any).LastEvaluatedKey;
    } while (lastKey);

    // batch delete (25 per request)
    let deleted = 0;
    const BATCH = 25;
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH);
      const reqs = chunk.map(k => ({ DeleteRequest: { Key: { PK: k.PK, SK: k.SK } } }));
      const params: any = { RequestItems: { [TBL_USAGE]: reqs } };
      try {
        await ddb.send(new BatchWriteItemCommand(params));
        deleted += chunk.length;
      } catch (e) {
        console.warn('[warn] prune usage batch delete failed', e);
      }
    }

    return deleted;
  } catch (e) {
    console.warn('[warn] pruneOldUsageCountersAll failed:', e);
    throw e;
  }
}


// Count posted records for dry-run deletePosted mode
async function countPostedCandidates(userId: any) {
  try {
    let lastKey: any = undefined;
    let totalCandidates = 0;
    let totalScanned = 0;
    do {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: { 
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "SCHEDULEDPOST#" },
        },
        ProjectionExpression: "scheduledAt, status, isDeleted, postedAt",
        ExclusiveStartKey: lastKey,
      }));

      for (const it of (q.Items || [])) {
        try {
          totalScanned++;
          const status = getS(it.status) || "";
          const isDeleted = it.isDeleted?.BOOL === true;
          const postedAt = normalizeEpochSec(getN(it.postedAt) || 0);
          // postedAt > 0 or status === 'posted' indicates posted
          if (isDeleted) continue;
          if (postedAt > 0 || status === 'posted') totalCandidates++;
        } catch (e) {
          console.error('[error] countPostedCandidates iteration failed:', String(e));
          throw e;
        }
      }

      lastKey = q.LastEvaluatedKey;
    } while (lastKey);

    return { candidates: totalCandidates, scanned: totalScanned };
  } catch (e) {
    console.warn("[warn] countPostedCandidates failed:", e);
    throw e;
  }
}

// Physically delete posted records for a specific user
async function deletePostedForUser(userId: any) {
  try {
    let lastKey: any = undefined;
    let totalDeleted = 0;
    do {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: { 
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "SCHEDULEDPOST#" },
        },
        ProjectionExpression: "PK,SK,postedAt,status,isDeleted",
        ExclusiveStartKey: lastKey,
      }));

      for (const it of (q.Items || [])) {
        try {
          const postedAt = Number(getN(it.postedAt) || 0);
          const status = getS(it.status) || "";
          const isDeleted = it.isDeleted?.BOOL === true;
          if (isDeleted) continue;
          if (postedAt > 0 || status === 'posted') {
            await ddb.send(new DeleteItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
          }
        } catch (e) { console.warn('[warn] deletePosted failed for item', e); }
      }

      lastKey = q.LastEvaluatedKey;
    } while (lastKey);

    if (totalDeleted > 0) await putLog({ userId, type: 'prune', status: 'info', message: `deleted posted ${totalDeleted} items` });
    return totalDeleted;
  } catch (e) { console.warn('[warn] deletePostedForUser failed:', e); throw e; }
}

// Delete up to `limit` posted items for a given user/account. Returns { deletedCount, remaining }
async function deleteUpTo100PostsForAccount(userId: any, accountId: any, limit = 100) {
  try {
    // Prefer the unified shared implementation in src/lib (use lambda-local wrapper)
    const pkg: any = await import('./lib/delete-posts-for-account').catch(() => null);
    const fn = pkg?.default || pkg?.deletePostsForAccount || pkg;
    if (!fn || typeof fn !== 'function') throw new Error('deletePostsForAccount_missing');
    const res = await fn({ userId, accountId, limit });
    try { console.info('[info] deleteUpTo100PostsForAccount result', { userId, accountId, res }); } catch(_) {}
    return { deletedCount: Number(res?.deletedCount || 0), remaining: !!res?.remaining };
  } catch (e) {
    const msg = String((e as any)?.message || e || '');
    try { console.warn('[warn] deleteUpTo100PostsForAccount failed', { userId, accountId, error: msg }); } catch(_) {}
    // If error due to missing/invalid oauth token, mark account reauth_required and skip (leave queue)
    try {
      if (msg.includes('missing_oauth_access_token') || /threads_fetch_failed:\s*4(01|03)/.test(msg) || /threads_delete_failed:\s*4(01|03)/.test(msg) || msg.includes('oauth_refresh_failed') || msg.includes('oauth_refresh_error')) {
        try { await ddb.send(new UpdateItemCommand({ TableName: TBL_THREADS_ACCOUNTS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET #st = :s', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'reauth_required' } } })); } catch (ee) { try { console.warn('[warn] mark reauth_required failed', { userId, accountId, error: String(ee) }); } catch(_) {} }
        await putLog({ userId, accountId, action: 'deletion', status: 'warn', message: 'reauth_required_set_due_to_token', detail: { error: msg } });
        return { deletedCount: 0, remaining: true };
      }
    } catch (_) {}
    throw e;
  }
}

// Process DeletionQueue: claim due items and run deletion batches
async function processDeletionQueueForUser(userId: any, opts: any = {}) {
  let totalDeleted = 0;
  try {
    // scan for due queue items
    const now = nowSec();
    // prefer AppConfig value for table name when available
    try { console.info('[info] processDeletionQueueForUser start', { userId }); } catch (_) {}
    await config.loadConfig();
    const dqTable = config.getConfigValue('TBL_DELETION_QUEUE') || process.env.TBL_DELETION_QUEUE || 'DeletionQueue';
    try { console.info('[info] DeletionQueue table resolved', { dqTable }); } catch (_) {}
    const out = await ddb.send(new ScanCommand({ TableName: dqTable }));
    const items = (out as any).Items || [];
    try { console.info('[info] DeletionQueue scan result', { count: (items || []).length }); } catch (_) {}
    for (const it of items) {
      const accountId = getS(it.accountId) || '';
      const sk = getS(it.SK) || '';
      // prefer owner userId stored on the queue item; fall back to the handler userId
      const ownerUserId = getS(it.userId) || userId;
      const processing = it.processing?.BOOL === true;
      const last = it.last_processed_at?.N ? Number(it.last_processed_at.N) : 0;
      const currentRetryCount = it.retry_count?.N ? Number(it.retry_count.N) : 0;
      // determine interval from AppConfig or env (hours)
      const intervalHoursVal = config.getConfigValue('DELETION_PROCESSING_INTERVAL_HOURS') || process.env.DELETION_PROCESSING_INTERVAL_HOURS || '24';
      const intervalHours = Number(intervalHoursVal) || 24;
      const intervalSeconds = intervalHours * 3600;
      const maxRetriesVal = config.getConfigValue('DELETION_RETRY_MAX') || process.env.DELETION_RETRY_MAX || process.env.DELETION_API_RETRY_COUNT || '3';
      const maxRetries = Number(maxRetriesVal) || 3;
      try { console.info('[info] queue item', { accountId, sk, ownerUserId, processing, last, currentRetryCount, intervalHours, maxRetries }); } catch (_) {}
      if (processing) continue;
      if (!(last === 0 || now - last >= intervalSeconds)) continue;

      // try to claim
      try {
        try { console.info('[info] attempting to claim queue item', { accountId, sk, ownerUserId }); } catch(_) {}
        await ddb.send(new UpdateItemCommand({ TableName: dqTable, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } }, UpdateExpression: 'SET processing = :t', ConditionExpression: 'attribute_not_exists(processing) OR processing = :f', ExpressionAttributeValues: { ':t': { BOOL: true }, ':f': { BOOL: false } } }));
        try { console.info('[info] claimed queue item', { accountId, sk, ownerUserId }); } catch(_) {}
        // Mark account status as deleting to prevent concurrent auto-generation while we process deletion
        try {
          try { await ddb.send(new UpdateItemCommand({ TableName: TBL_THREADS_ACCOUNTS, Key: { PK: { S: `USER#${ownerUserId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET #st = :s', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'deleting' } } })); } catch (ee) { try { console.warn('[warn] failed to set account deleting status', { ownerUserId, accountId, error: String(ee) }); } catch(_) {} }
        } catch(_) {}
      } catch (e) {
        try { console.warn('[warn] failed to claim queue item, skipping', { accountId, sk, ownerUserId, error: String(e) }); } catch(_) {}
        // someone else claimed or claim failed
        continue;
      }

      try {
        // Load config - fail fast if AppConfig cannot be read
        await config.loadConfig();
        const batchSizeVal = config.getConfigValue('DELETION_BATCH_SIZE');
        const batchSize = Number(batchSizeVal || '100') || 100;
        try { console.info('[info] invoking deleteUpTo100PostsForAccount', { ownerUserId, accountId, batchSize, dryRun: !!(opts && opts.dryRun) }); } catch(_) {}
        if (opts && opts.dryRun) {
          // Count candidates without performing deletes
          try {
            const cnt = await countPostedCandidates(ownerUserId);
            const deletedWouldBe = Number(cnt?.candidates || 0);
            totalDeleted += deletedWouldBe;
            try { await putLog({ userId: ownerUserId, type: 'deletion', status: 'info', message: `dry-run deletion: ${deletedWouldBe} candidates for account ${accountId}` }); } catch(_) {}
            // release processing flag and continue
            try { await ddb.send(new UpdateItemCommand({ TableName: dqTable, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } }, UpdateExpression: 'SET processing = :f, last_processed_at = :ts', ExpressionAttributeValues: { ':f': { BOOL: false }, ':ts': { N: String(now) } } })); } catch(_) {}
            continue;
          } catch (e) {
            try { console.warn('[warn] dry-run countPostedCandidates failed', { ownerUserId, accountId, err: String(e) }); } catch(_) {}
            // fallthrough to non-dry-run behavior as a fallback
          }
        }
        const res = await deleteUpTo100PostsForAccount(ownerUserId, accountId, batchSize);
        try { console.info('[info] deleteUpTo100PostsForAccount result', { ownerUserId, accountId, res }); } catch(_) {}
        totalDeleted += Number(res?.deletedCount || 0);
        if (!res.remaining) {
          // deletion complete -> remove queue and set account status active
          await ddb.send(new DeleteItemCommand({ TableName: dqTable, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } } }));
          await ddb.send(new UpdateItemCommand({ TableName: TBL_THREADS_ACCOUNTS, Key: { PK: { S: `USER#${ownerUserId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET #st = :s', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'active' } } }));
          await putLog({ userId: ownerUserId, type: 'deletion', accountId, status: 'info', message: 'deletion_completed', detail: { deleted: res.deletedCount } });
          // notify discord about completion
          try { await postDiscordLog({ userId: ownerUserId, content: `**[DELETION completed]** account=${accountId} deleted=${res.deletedCount}` }); } catch (_) {}
        } else {
          // update last_processed_at and release
          await ddb.send(new UpdateItemCommand({ TableName: dqTable, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } }, UpdateExpression: 'SET processing = :f, last_processed_at = :ts', ExpressionAttributeValues: { ':f': { BOOL: false }, ':ts': { N: String(now) } } }));
          await putLog({ userId: ownerUserId, type: 'deletion', accountId, status: 'info', message: 'deletion_progress', detail: { deleted: res.deletedCount } });
          // notify discord about progress
          try { await postDiscordLog({ userId: ownerUserId, content: `**[DELETION progress]** account=${accountId} deleted=${res.deletedCount} remaining=true` }); } catch (_) {}
        }
      } catch (e) {
        // mark as error and release processing flag
        try { await ddb.send(new UpdateItemCommand({ TableName: dqTable, Key: { PK: { S: `ACCOUNT#${accountId}` }, SK: { S: sk } }, UpdateExpression: 'SET processing = :f, last_processed_at = :ts, retry_count = if_not_exists(retry_count, :z) + :inc, last_error = :err', ExpressionAttributeValues: { ':f': { BOOL: false }, ':ts': { N: String(now) }, ':z': { N: '0' }, ':inc': { N: '1' }, ':err': { S: String((e as any)?.message || e) } } })); } catch (_) {}
        try { console.warn('[warn] deletion batch error', { ownerUserId, accountId, sk, error: String(e) }); } catch (_) {}
        // if retry count exceeded, mark account status deletion_error
        try {
          const newRetry = currentRetryCount + 1;
          if (newRetry >= maxRetries) {
            // set account status to deletion_error
            // Guard: only update existing ThreadsAccounts items to avoid creating phantom records
            try {
              await ddb.send(new UpdateItemCommand({ TableName: TBL_THREADS_ACCOUNTS, Key: { PK: { S: `USER#${ownerUserId}` }, SK: { S: `ACCOUNT#${accountId}` } }, UpdateExpression: 'SET #st = :s', ConditionExpression: 'attribute_exists(PK)', ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': { S: 'deletion_error' } } }));
              await putLog({ userId: ownerUserId, type: 'deletion', accountId, status: 'error', message: 'deletion_max_retries_exceeded', detail: { retries: newRetry } });
            } catch (ee) {
              // If conditional update fails (item not exists), log a warn but do not create a new ThreadsAccounts item
              try { console.warn('[warn] conditional update skipped creating ThreadsAccounts (deletion_error):', { ownerUserId, accountId, error: String(ee) }); } catch(_){ }
              await putLog({ userId: ownerUserId, type: 'deletion', accountId, status: 'warn', message: 'deletion_max_retries_exceeded_no_account', detail: { retries: newRetry, error: String(ee) } });
            }
          }
        } catch (_) {}
        await putLog({ userId: ownerUserId, type: 'deletion', accountId, status: 'error', message: 'deletion_batch_failed', detail: { error: String(e) } });
      }
    }
  } catch (e) {
    console.warn('[warn] processDeletionQueueForUser failed:', e);
  }
  return { deletedCount: totalDeleted };
}

/// ========== マスタ通知（集計サマリ） ==========
function getMasterWebhookUrl() {
  return process.env.MASTER_DISCORD_WEBHOOK || process.env.DISCORD_MASTER_WEBHOOK || "";
}

async function postDiscordMaster(content: any) {
  const url = getMasterWebhookUrl();
  if (!url) {
    console.info("[info] MASTER_DISCORD_WEBHOOK 未設定のためマスタ通知スキップ");
    return;
  }
  try {
    await postDiscord([url], content);
  } catch (e) {
    console.warn("[warn] master discord post failed:", String(e));
  }
}

// ====== 通知: 非ゼロの項目だけを結合し、全てゼロなら「実行なし」
function formatNonZeroLine(items: Array<{ label: string; value: number; suffix?: string }>, job?: string) {
  const parts = items
    .filter(i => (Number(i.value) || 0) > 0)
    .map(i => `${i.label}: ${i.value}${i.suffix || ''}`);
  if (parts.length > 0) return parts.join(" / ");
  // 簡略表示: ジョブ名が与えられれば `${job}：実行なし` を返す
  if (job) return `${job}：実行なし`;
  return "実行なし";
}

function formatMasterMessage({ job, startedAt, finishedAt, userTotal, userSucceeded, totals }: any) {
  const durMs = finishedAt - startedAt;
  const durSec = Math.max(1, Math.round(durMs / 1000));

  // Format finishedAt as JST 'YYYY-MM-DD HH:mm:ss'
  function formatJstShort(ms: number) {
    const d = new Date(ms + 9 * 3600 * 1000); // shift to JST then use UTC getters
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  const jstShort = formatJstShort(finishedAt);
  if (job === "hourly") {
    const line = formatNonZeroLine([
      { label: "予約投稿作成 合計", value: totals.createdCount },
      { label: "返信取得 合計", value: totals.fetchedReplies },
      { label: "下書き生成", value: totals.replyDrafts },
      { label: "スキップ件数", value: totals.skippedAccounts },
      { label: "投稿削除 合計", value: totals.deletedCount || 0 },
    ]);
    return [
      `**[HOURLY] 定期実行サマリ ${jstShort}**`,
      `スキャンユーザー数: ${userTotal} / 実行成功: ${userSucceeded}`,
      line,
      `所要時間: ${durSec}s`
    ].join("\n");
  }

  if (job === "daily-prune" || job === "prune") {
    // Build per-table lines if available in totals
    const lines: string[] = [];
    if (typeof totals.scheduledNormalDeleted !== 'undefined') lines.push(`通常投稿${totals.scheduledNormalDeleted}件削除 / 全${totals.scheduledNormalTotal}件`);
    if (typeof totals.scheduledQuoteDeleted !== 'undefined') lines.push(`引用投稿${totals.scheduledQuoteDeleted}件削除 / 全${totals.scheduledQuoteTotal}件`);
    if (typeof totals.repliesDeleted !== 'undefined') lines.push(`リプライ${totals.repliesDeleted}件削除 / 全${totals.repliesTotal}件`);
    if (typeof totals.executionLogsDeleted !== 'undefined') lines.push(`ExecutionLogs${totals.executionLogsDeleted}件削除 / 全${totals.executionLogsTotal}件`);
    if (typeof totals.usageCountersDeleted !== 'undefined') lines.push(`UsageCounters${totals.usageCountersDeleted}件削除 / 全${totals.usageCountersTotal}件`);
    if (typeof totals.pruneMs !== 'undefined') lines.push(`処理時間: ${Math.round(Number(totals.pruneMs) / 1000)}s`);
    if (lines.length === 0) {
      return [`**[PRUNE] 定期実行サマリ ${jstShort}**`, `スキャンユーザー数: ${userTotal}`, `所要時間: ${durSec}s`].join("\n");
    }
    return [`**[PRUNE] 定期実行サマリ ${jstShort}**`, ...lines, `所要時間: ${durSec}s`].join("\n");
  }

  const line = formatNonZeroLine([
    { label: "自動投稿 合計", value: totals.totalAuto },
    { label: "リプ返信 合計", value: totals.totalReply },
    { label: "2段階投稿 合計", value: totals.totalTwo },
    { label: "失効(rate-limit) 合計", value: totals.rateSkipped },
  ]);
  return [
    `**[5MIN] 定期実行サマリ ${jstShort}**`,
    `スキャンユーザー数: ${userTotal} / 実行成功: ${userSucceeded}`,
    line,
    `所要時間: ${durSec}s`
  ].join("\n");
}
