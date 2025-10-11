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
  DeleteItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
// @ts-expect-error: path aliases resolved at build time
import config from '@/lib/config';
// @ts-expect-error: path aliases resolved at build time
import { postToThreads as sharedPostToThreads, postQuoteToThreads as sharedPostQuoteToThreads } from '@/lib/threads';
import crypto from "crypto";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// Disable test-only global output collector by installing a resilient no-op collector.
// This prevents scattered test pushes from emitting debug data without changing every call site.
try {
  (function() {
    let internal: any[] = [];
      configurable: true,
      enumerable: true,
      get() { return internal; },
      set(v) { internal = Array.isArray(v) ? v : []; internal.push = () => {}; }
    });
    // initialize and ensure push is a no-op
  })();
} catch (_) {}

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

/// ========== 共通ユーティリティ ==========
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
        "doublePostDelay, autoPost, dailyOpenAiLimit, defaultOpenAiCost, openaiApiKey, selectedModel, masterPrompt, quotePrompt, openAiTemperature, openAiMaxTokens, autoPostAdminStop, doublePostDelete, doublePostDeleteDelay, parentDelete",
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

async function createScheduledPost(userId: any, { acct, group, type, whenJst, overrideTheme = "", overrideTimeRange = "", secondStageWanted = undefined }: any) {
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
  await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: sanitizeItem(item) }));
  return { id, groupTypeStr, themeStr };
}

// Create a quote reservation for an account if opted-in and monitored account has a new post
async function createQuoteReservationForAccount(userId: any, acct: any) {
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
    // Use AppConfig as the authoritative source for OpenAI API key per request.
    try {
      await config.loadConfig();
      const cfgKey = config.getConfigValue('OPENAI_API_KEY');
      if (cfgKey) settings.openaiApiKey = cfgKey;
    } catch (e) {
      // If AppConfig cannot be loaded, record error and skip generation
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "error", message: "AppConfigの読み込み失敗", detail: { error: String(e) } });
    
      return false;
    }
    if (!settings?.openaiApiKey) {
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "skip", message: "AppConfig に OPENAI_API_KEY が設定されていないため本文生成をスキップ" });
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
      } catch (e) {
        try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, targetId: scheduledPostId, status: 'error', message: '引用元投稿取得エラー', detail: { error: String(e) } }); } catch (_) {}
        return false;
      }

      // quoteInstruction: always use a concise instruction block here.
      // The detailed policyPrompt (user/AppConfig/master) is already included above and
      // should not be duplicated in the instruction section to avoid repetition.
      const defaultQuoteInstruction = `【指示】\n上記の引用元投稿に自然に反応する形式で、共感や肯定、専門性を含んだ引用投稿文を作成してください。200〜400文字以内。ハッシュタグ禁止。改行は最大1回。`;

      // Prefer user settings quotePrompt, else AppConfig QUOTE_PROMPT, else masterPrompt
      let policyPrompt = "";
      try {
        if (settings && String(settings.quotePrompt || "").trim()) {
          policyPrompt = String(settings.quotePrompt).trim();
        }
      } catch (_) { policyPrompt = ""; }
      try {
        if (!policyPrompt) {
          await config.loadConfig();
          policyPrompt = String(config.getConfigValue('QUOTE_PROMPT') || "").trim();
        }
      } catch (_) {}
      if (!policyPrompt) policyPrompt = String(settings.masterPrompt || "").trim();

      // Build prompt: include policy (if any), persona, then the QUOTE source once and the concise instruction.
      // If we have a full quoteIntro (source text), prefer that and do NOT also include 投稿テーマ to avoid duplication.
      const policyBlock = policyPrompt ? `【運用方針】\n${policyPrompt}\n\n` : "";
      const personaBlock = personaText ? `【アカウントのペルソナ】\n${personaText}\n\n` : `【アカウントのペルソナ】\n(未設定)\n\n`;
  const sourceBlock = (isQuoteType && quoteIntro) ? `${quoteIntro}` : `【投稿テーマ】\n${String(sourceTextForPrompt)}\n\n`;

      // Build the prompt from the previously prepared blocks
      const prompt: string = `${policyBlock}${personaBlock}${sourceBlock}${defaultQuoteInstruction}`.trim();
      try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, targetId: scheduledPostId, status: 'info', message: 'prompt_constructed', detail: { isQuoteType, policyPromptUsed: Boolean(policyPrompt), themeSample: String(sourceTextForPrompt).slice(0,200) } }); } catch(_) {}

    // OpenAI 呼び出しは共通ヘルパーを使い、内部でリトライ／フォールバックする
    let text: any = undefined;
    try {
      // log call metadata (do not log API key)
      // OpenAI call start (minimal logging)
      try { /* debug removed */ } catch (_) {}

      // Prepare OpenAI request payload (mask API key when logging)
      const openAiRequestPayload: any = {
        apiKey: settings.openaiApiKey,
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
          // Include the full prompt for test inspection (no API keys)
        } catch (_) {}

      // Also emit explicit settings/payload snapshot (masked) so test runs can verify key presence and payload
      try {
      } catch (_) {}
      } catch (_) {}

      const openAiRes = await callOpenAIText(openAiRequestPayload);
      text = openAiRes?.text;
      // when running tests, attach the full OpenAI response to test output for inspection
      try {
      } catch (_) {}

      // log response length only (avoid full text in logs)
      try { /* debug removed */ } catch(_) {}
      // also persist a small trace to ExecutionLogs for easier post-mortem (no full text stored to DB)
      try { await putLog({ userId, type: 'openai-call', accountId: acct.accountId, targetId: scheduledPostId, status: 'info', message: 'openai_call_complete', detail: { textLength: text ? String(text).length : 0 } }); } catch (_) {}
    } catch (e) {
      // record failure and rethrow to be handled by caller
      try { console.error('[error] OpenAI call failed', String(e)); } catch(_) {}
      try { await putLog({ userId, type: 'openai-call', accountId: acct.accountId, targetId: scheduledPostId, status: 'error', message: 'openai_call_failed', detail: { error: String(e) } }); } catch (_) {}
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
        } catch (e) { /* non-fatal */ }
        return true;
      } else {
        try { console.warn('[warn] generated text invalid or too short', { scheduledPostId, originalLength: text ? String(text).length : 0, cleanedLength: cleanText ? cleanText.length : 0 }); } catch(_) {}
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "error", message: "生成されたテキストが不正です", detail: { originalText: text, cleanedText: cleanText } });
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

  const item = {
    PK: { S: `USER#${userId}` },
    SK: { S: `LOG#${Date.now()}#${crypto.randomUUID()}` },
    type: { S: type || "system" },
    accountId: { S: accountId },
    targetId: { S: targetId },
    status: { S: status },
    message: { S: message },
    detail: { S: JSON.stringify(detail || {}) },
    createdAt: { N: String(nowSec()) },
  };
  try {
    await ddb.send(new PutItemCommand({ TableName: TBL_LOGS, Item: item }));
  } catch (e) {
    const error = e as Error;
    console.warn("[warn] putLog skipped:", String(error?.name || error));
  }
}

// persistDebugLog removed (test utility)

type EventLike = { userId?: string };

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
const MASTER_DISCORD_WEBHOOK = process.env.MASTER_DISCORD_WEBHOOK || "";

/// ========== ハンドラ（5分＆毎時の分岐 + テストモード） ==========
export const handler = async (event: any = {}) => {
  const job = event?.job || "every-5min";
  // handler invoked (lean logging for production)

  // Unified AppConfig load at handler startup to avoid inconsistent loads across flows
  try {
    await config.loadConfig();
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
      }
    } catch (_) {}
  } catch (e) {
    // Record failure; in testInvocation return error so user sees failure early
    try { await putLog({ type: 'system', status: 'error', message: 'AppConfig load failed at handler startup', detail: { error: String(e) } }); } catch (_) {}
    if (event?.testInvocation) {
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
      return { statusCode: 200, body: JSON.stringify({ testInvocation: true, action: 'checkAppConfig', result: out, testOutput: testOut }) };
    } catch (e) {
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
        const res = await runHourlyJobForUser(userId);
        // For test mode, also process deletion queue for this user so tests exercise deletion flow
        let dqRes: any = { deletedCount: 0 };
        try {
          dqRes = await processDeletionQueueForUser(userId);
        } catch (e) {
          console.warn('[TEST] processDeletionQueueForUser failed:', String(e));
          try { await putLog({ userId, type: 'deletion', status: 'error', message: 'test_process_deletion_failed', detail: { error: String(e) } }); } catch(_){}
        }
        const merged = Object.assign({}, res || {}, { deletedCount: Number(dqRes?.deletedCount || 0) });
        return { statusCode: 200, body: JSON.stringify({ testInvocation: true, job: 'hourly', userId, accountIds, result: merged }) };
      } else {
        
        const res = await runFiveMinJobForUser(userId);
        // attach any collected test-time output from threads lib so caller can inspect POST bodies
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
          const res = await runHourlyJobForUser(uid);
          succeeded += 1;
          totals.createdCount += Number(res.createdCount || 0);
          totals.fetchedReplies += Number(res.fetchedReplies || 0);
          totals.replyDrafts += Number(res.replyDrafts || 0);
          totals.skippedAccounts += Number(res.skippedAccounts || 0);
        // Also attempt to process deletion queue for this user (batch deletions)
        try {
          const dqRes = await processDeletionQueueForUser(uid);
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
    const dryRun = !!event.dryRun;
    const singleUser = event.userId || null;
    const deletePosted = !!event.deletePosted; // if true, perform deletion of posted records
    const confirmPostedDelete = !!event.confirm; // safety: require confirm=true to actually delete posted items

    const userIds = singleUser ? [singleUser] : await getActiveUserIds();
    // If no userId specified, also compute pre-filter total across the whole table
    let preFilterTotal: number | null = null;
    if (!singleUser) {
      try {
        preFilterTotal = await countAllScheduledPosts();
        await postDiscordMaster(`**[PRUNE] pre-filter total items across table: ${preFilterTotal}**`);
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
        // 実行ログも削除
        try {
          const dl = await pruneOldExecutionLogs(uid);
          totalDeleted += Number(dl || 0);
          totalLogDeleted += Number(dl || 0);
        } catch (e) { console.warn('[warn] pruneOldExecutionLogs failed for', uid, e); }
      } catch (e) {
        console.warn("[warn] daily-prune failed for", uid, e);
        await putLog({ userId: uid, type: "prune", status: "error", message: "daily prune failed", detail: { error: String(e) } });
      }
    }

    if (dryRun) {
      const finishedAt = Date.now();
      // build totals object expected by formatMasterMessage
      const t = { candidates: totalCandidates, scanned: totalScanned, deleted: 0, preFilterTotal } as any;
      await postDiscordMaster(formatMasterMessage({ job: "daily-prune", startedAt, finishedAt, userTotal: userIds.length, userSucceeded: 0, totals: t }));
      return { statusCode: 200, body: JSON.stringify({ dryRun: true, preFilterTotal, candidates: totalCandidates, scanned: totalScanned }) };
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
        // also perform full-table execution logs prune
        let allLogDeleted = 0;
        try { allLogDeleted = await pruneOldExecutionLogsAll(); } catch (_) { allLogDeleted = 0; }
        const finishedAt = Date.now();
        const t = { candidates: totalCandidates, scanned: totalScanned, deleted: allDeleted, preFilterTotal, logDeleted: allLogDeleted } as any;
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
    const totals: any = { totalAuto: 0, totalReply: 0, totalTwo: 0, rateSkipped: 0 };
    for (const uid of userIds) {
      try {
        const res = await runFiveMinJobForUser(uid);
        succeeded += 1;
        totals.totalAuto += Number(res.totalAuto || 0);
        totals.totalReply += Number(res.totalReply || 0);
        totals.totalTwo += Number(res.totalTwo || 0);
        totals.rateSkipped += Number(res.rateSkipped || 0);
      } catch (e) {
        try { await putLog({ userId: uid, type: 'every-5min', status: 'error', message: 'run5min_failed', detail: { error: String(e) } }); } catch(_) {}
      }
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
  const pickedMin = sm + Math.floor(Math.random() * (em - sm + 1));
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

    // ユーザー設定取得
    const settings = await getUserSettings(userId);
    let responseContent = "";
    
    // OpenAIで返信コンテンツを生成
    if (settings?.openaiApiKey && acct.autoReply) {
      try {
        const replyPrompt = buildReplyPrompt(text, originalPost?.content || "", settings, acct);
        const { text: generatedReply } = await callOpenAIText({
          apiKey: settings.openaiApiKey,
          model: settings.model || DEFAULT_OPENAI_MODEL,
          temperature: settings.openAiTemperature ?? DEFAULT_OPENAI_TEMP,
          max_tokens: settings.openAiMaxTokens ?? DEFAULT_OPENAI_MAXTOKENS,
          prompt: replyPrompt,
        });
        
        // 投稿生成と同様のクリーニング処理を適用
        let cleanReply = generatedReply || "";
        
        if (cleanReply) {
          cleanReply = cleanReply.trim();
          
          // プロンプトの指示部分が含まれている場合の除去処理
          if (cleanReply.includes("【指示】") || cleanReply.includes("【運用方針】") || cleanReply.includes("【受信したリプライ】")) {
            // 【指示】以降のテキストを除去
            const instructionIndex = cleanReply.lastIndexOf("【指示】");
            if (instructionIndex !== -1) {
              cleanReply = cleanReply.substring(0, instructionIndex).trim();
            }
            
            // 他の指示セクションも除去
            cleanReply = cleanReply.replace(/【運用方針[^】]*】\n?/g, "");
            cleanReply = cleanReply.replace(/【元の投稿】\n?[^【]*\n?/g, "");
            cleanReply = cleanReply.replace(/【受信したリプライ】\n?[^【]*\n?/g, "");
            
            // 空行を整理
            cleanReply = cleanReply.replace(/\n\s*\n/g, "\n").trim();
          }
          
          // 引用符やマークダウン記法の除去
          cleanReply = cleanReply.replace(/^[「『"']|[」』"']$/g, "");
          cleanReply = cleanReply.replace(/^\*\*|\*\*$/g, "");
          cleanReply = cleanReply.trim();
        }
        
        responseContent = cleanReply;
      } catch (e) {
        console.warn(`[warn] 返信コンテンツ生成失敗: ${String(e)}`);
        await putLog({ 
          userId, type: "reply-generate", accountId: acct.accountId, 
          status: "error", message: "返信コンテンツ生成失敗", 
          detail: { error: String(e) } 
        });
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
async function ensureNextDayAutoPosts(userId: any, acct: any) {
  // アカウント側の大枠ガード
  if (!acct.autoGenerate) return { created: 0, skipped: true };
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
  const useSlots = slots.slice(0, 10);
  

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

    // 既に明日分があるか？
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

    // 前日分の未投稿自動投稿を物理削除
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const deletedCount = await deleteUnpostedAutoPosts(userId, acct, groupTypeStr, yesterday);
    deleted += deletedCount;

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
    });
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

  let cand = null;
  let iterIndex = 0;
  for (const it of (q.Items || [])) {
    const pk = getS(it.PK) || '';
    const sk = getS(it.SK) || '';

    // 本体を取得して status/postedAt/timeRange を確認
    const full = await ddb.send(new GetItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: String(pk) }, SK: { S: String(sk) } },
      ProjectionExpression: "content, postedAt, timeRange, scheduledAt, autoPostGroupId, numericPostId, #st, #type",
      ExpressionAttributeNames: { "#st": "status", "#type": "type" }
    }));
    const x = unmarshall(full.Item || {});
    // 詳細デバッグ: 対象アカウントだったらフルアイテムとパース後オブジェクトを出力
    if (acct.accountId === 'remigiozarcorb618' || userId === 'b7b44a38-e051-70fa-2001-0260ae388816') {
      try {
        
      } catch (e) { /* debug removed */ }
      try { /* debug removed */ } catch(e) { /* debug removed */ }
    }
    const postedZero = !x.postedAt || x.postedAt === 0 || x.postedAt === "0";
    const stOK = (x.status || "") === "scheduled";

    // timeRange がある場合は失効チェック
    const notExpired = !x.timeRange || (() => {
      const endJst = rangeEndOfDayJst(x.timeRange, jstFromEpoch(Number(x.scheduledAt || 0)));
      return !endJst || nowSec() <= toEpochSec(endJst);
    })();

    if (debugMode && (debugInfo.items as any[]).length < 6) {
      (debugInfo.items as any[]).push({
        idx: iterIndex,
        pk, sk,
        status: x.status,
        postedAt: x.postedAt,
        scheduledAt: x.scheduledAt,
        timeRange: x.timeRange,
        stOK, postedZero, notExpired,
      });
    }
    iterIndex++;

    if (stOK && postedZero && notExpired) {
      cand = { pk, sk, ...x };
      await putLog({
        userId,
        type: "auto-post",
        accountId: acct.accountId,
        targetId: sk,
        status: "probe",
        message: "candidate found",
        detail: { scheduledAt: x.scheduledAt, timeRange: x.timeRange }
      });
      if (debugMode) {
        debugInfo.candidate = { pk, sk, scheduledAt: x.scheduledAt, timeRange: x.timeRange, hasContent: !!x.content };
      }
      break;
    } else {
      // notExpired が false の場合、時刻範囲を過ぎている可能性がある
      if (stOK && postedZero && !notExpired) {
        await putLog({
          userId,
          type: "auto-post",
          accountId: acct.accountId,
          targetId: sk,
          status: "skip",
          message: `時刻範囲(${x.timeRange})を過ぎたため投稿せず失効`
        });
        if (debugMode) {
          if (!debugInfo.skips) debugInfo.skips = [];
          debugInfo.skips.push({ sk, reason: 'window_expired', scheduledAt: x.scheduledAt, timeRange: x.timeRange });
        }
      }
    }
  }

  // 候補が無ければ今回は投稿なし
  if (!cand) return debugMode ? { posted: 0, debug: debugInfo } : { posted: 0 };

  // 以降の処理で使う値（従来の q.Items[0] 由来の値を置き換える）
  const pk = cand.pk;
  const sk = cand.sk;
  const text = (cand as any).content || "";
  const range = (cand as any).timeRange || "";
  const scheduledAtSec = Number((cand as any).scheduledAt || 0);

  // 本文が空ならスキップ（次回リトライ）
  if (!text) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "skip", message: "本文が未生成のためスキップ" });
    if (debugMode) {
      debugInfo.reason = 'no_content';
      debugInfo.scheduledAt = scheduledAtSec;
      debugInfo.textLength = text ? text.length : 0;
      return { posted: 0, debug: debugInfo };
    }
    return { posted: 0 };
  }

  // 予約の時刻範囲を超過していたら失効
  if (range && scheduledAtSec > 0) {
    const schDateJst = jstFromEpoch(scheduledAtSec);
    const endJst = rangeEndOfDayJst(range, schDateJst);
    if (endJst && nowSec() > toEpochSec(endJst)) {
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_SCHEDULED,
          Key: { PK: { S: pk }, SK: { S: sk } },
          UpdateExpression: "SET #st = :expired, expiredAt = :ts, expireReason = :rsn",
          ConditionExpression: "#st = :scheduled",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":expired":   { S: "expired" },
            ":scheduled": { S: "scheduled" },
            ":ts":        { N: String(nowSec()) },
            ":rsn":       { S: "time-window-passed" },
          },
        }));
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "skip", message: `時刻範囲(${range})を過ぎたため投稿せず失効` });
      } catch (e) {
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "失効処理に失敗", detail: { error: String(e) } });
      }
      return { posted: 0, skipped: "window_expired" };
    }
  }

  // Threads の user-id を未保持なら取得して保存
  if (!acct.providerUserId) {
    const pid = await ensureProviderUserId(userId, acct);
    if (!pid) {
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "ThreadsのユーザーID未取得のため投稿不可" });
      return { posted: 0 };
    }
  }
  // Require oauthAccessToken; do not fallback to legacy accessToken
  if (!acct.oauthAccessToken) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "ThreadsのoauthAccessToken未設定（accessTokenは使用不可）" });
    return { posted: 0 };
  }

  // 実投稿 → 成功時のみ posted に更新（冪等）
  try {
    // Debug: log token fields to help investigate missing-token errors
    try {
      const tokenHashDebug = acct.oauthAccessToken ? crypto.createHash('sha256').update(String(acct.oauthAccessToken)).digest('hex').slice(0,12) : (acct.accessToken ? crypto.createHash('sha256').update(String(acct.accessToken)).digest('hex').slice(0,12) : '');
      try { await putLog({ userId, type: 'auto-post', accountId: acct.accountId, targetId: sk, status: 'info', message: 'token_inspection', detail: { accessTokenPresent: !!acct.accessToken, oauthAccessTokenPresent: !!acct.oauthAccessToken, tokenHash: tokenHashDebug } }); } catch(_) {}
    } catch (e) {
      console.error('[error] runAutoPostForAccount token-inspection failed:', String(e));
      throw e;
    }
    // If this scheduled item is a quote (type === 'quote'), use the quote post flow
    let postResult: { postId: string; numericId?: string };
    const isQuote = (cand as any).type === 'quote';
    // For testing, allow quote posting when the test flag is set. Otherwise fall back to normal posts.
    if (isQuote) {
      const referenced = (cand as any).numericPostId || "";
      if (!referenced) {
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "引用元の数値IDが存在しないため引用投稿をスキップ（失敗）" });
        return { posted: 0 };
      }
      // Ensure providerUserId matches token owner to avoid referenced_posts loss
      try {
        const meResp = await fetch(`https://graph.threads.net/v1.0/me?fields=id&access_token=${encodeURIComponent(acct.oauthAccessToken || '')}`);
        if (meResp.ok) {
          try {
            const meJ = await meResp.json();
            const meId = meJ?.id || '';
            if (meId && acct.providerUserId && meId !== acct.providerUserId) {
              await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'info', message: 'providerUserId mismatch; updating to token owner', detail: { previous: acct.providerUserId, owner: meId } });
              acct.providerUserId = meId;
              try {
                await ddb.send(new UpdateItemCommand({ TableName: TBL_THREADS, Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${acct.accountId}` } }, UpdateExpression: 'SET providerUserId = :pid', ExpressionAttributeValues: { ':pid': { S: meId } } }));
              } catch (e) {
                // non-fatal
              }
            }
          } catch (_) {}
        }
      } catch (e) {
        // ignore and proceed; publish may still work
      }

      // Log create/publish endpoints and token presence for debug
      try {
        const tokenPreview = acct.oauthAccessToken ? `${String(acct.oauthAccessToken).slice(-6)}` : '(none)';
        await putLog({ userId, type: 'auto-post', accountId: acct.accountId, status: 'trace', message: 'quote-post-endpoint-debug', detail: { createEndpoint: 'POST https://graph.threads.net/v1.0/me/threads', publishEndpoint: acct.providerUserId ? `POST https://graph.threads.net/v1.0/${acct.providerUserId}/threads_publish` : 'POST https://graph.threads.net/v1.0/me/threads_publish', tokenPreview } });
      } catch (_) {}

      // Always attempt quote posting for quote-type items (no test gating)
      postResult = await sharedPostQuoteToThreads({
        accessToken: acct.oauthAccessToken,
        oauthAccessToken: acct.oauthAccessToken,
        text,
        referencedPostId: String(referenced),
        userIdOnPlatform: acct.providerUserId,
      });
    } else {
      postResult = await postToThreads({ accessToken: acct.oauthAccessToken, oauthAccessToken: acct.oauthAccessToken, text, userIdOnPlatform: acct.providerUserId });
    }

    let updateExpr = "SET #st = :posted, postedAt = :ts, postId = :pid";
    const updateValues: any = {
      ":posted":   { S: "posted" },
      ":scheduled":{ S: "scheduled" },
      ":ts":       { N: String(nowSec()) },
      ":pid":      { S: postResult.postId || "" },
    };

    // 数字IDも保存（リンク用IDと異なる場合）
    if (postResult.numericId && postResult.numericId !== postResult.postId) {
      updateExpr += ", numericPostId = :nid";
      updateValues[":nid"] = { S: postResult.numericId };
    }

    // 二段階投稿の初期化
    if (acct.secondStageContent && acct.secondStageContent.trim()) {
      updateExpr += ", doublePostStatus = :waiting";
      updateValues[":waiting"] = { S: "waiting" };
    }

    await ddb.send(new UpdateItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: pk }, SK: { S: sk } },
      UpdateExpression: updateExpr,
      ConditionExpression: "#st = :scheduled",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: updateValues,
    }));

    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "ok", message: "自動投稿を完了", detail: { platform: "threads" } });
    return { posted: 1 };
    } catch (e) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "投稿失敗", detail: { error: String(e) } });
    await postDiscordLog({ userId, isError: true, content: `**[ERROR auto-post] ${acct.displayName || acct.accountId}**\n${String(e).slice(0, 800)}` });
    return { posted: 0 };
  }
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
async function runHourlyJobForUser(userId: any) {
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

  let createdCount = 0;
  let fetchedReplies = 0;
  let replyDrafts = 0;
  let skippedAccounts = 0;
  const checkedShortcodes: Array<{ sourcePostId: string; queriedPK?: string; queriedAccountId?: string }> = [];

  for (const acct of accounts) {
    // First: try creating quote reservations for accounts that opted-in
    try {
      // Hourly: create quote reservations (reservation creation only)
      const qres = await createQuoteReservationForAccount(normalizedUserId, acct);
      if (qres && qres.created) createdCount += qres.created;
      if (qres && qres.skipped) skippedAccounts++;
      if (qres && qres.sourcePostId) checkedShortcodes.push({ sourcePostId: String(qres.sourcePostId), queriedPK: String(qres.queriedPK || ''), queriedAccountId: String(qres.queriedAccountId || '') });
    } catch (e) {
      console.warn('[warn] createQuoteReservationForAccount failed:', String(e));
    }

    const c = await ensureNextDayAutoPosts(normalizedUserId, acct);
    createdCount += c.created || 0;
    if (c.skipped) skippedAccounts++;

    try {
      if (!DISABLE_QUOTE_PROCESSING) {
        const fr = await fetchIncomingReplies(normalizedUserId, acct);
        fetchedReplies += fr.fetched || 0;
        replyDrafts += fr.fetched || 0; // 取得したリプライ分だけ返信ドラフトが生成される
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
  try { console.info('[info] hourly totals', { createdCount, fetchedReplies, replyDrafts, skippedAccounts }); } catch (e) { console.error('[error] hourly totals logging failed:', String(e)); }
  // `metrics` が空（= 実行なし）の場合は簡略化して 'hourly：実行なし' のみ送る
  const metrics = formatNonZeroLine([
    { label: "予約投稿作成", value: createdCount, suffix: " 件" },
    { label: "返信取得", value: fetchedReplies, suffix: " 件" },
    { label: "返信下書き", value: replyDrafts, suffix: " 件" },
    { label: "スキップ", value: skippedAccounts },
  ], "hourly");
  const content = metrics === "hourly：実行なし" ? metrics : `**[定期実行レポート] ${now} (hourly)**\n${metrics}`;
  await postDiscordLog({ userId, content });
  return { userId, createdCount, fetchedReplies, replyDrafts, skippedAccounts, checkedShortcodes };
}

// === 予約レコードの本文生成をアカウント単位で段階的に処理する（短期対応） ===
async function processPendingGenerationsForAccount(userId: any, acct: any, limit = 1) {
  if (!acct.autoGenerate) return { generated: 0, skipped: true };
  const now = nowSec();
  let generated = 0;
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
        
        continue;
      }
      const nextGen = Number(rec.nextGenerateAt || 0);
      // nextGenerateAt が将来に設定されていればスキップ（バックオフ等）
      if (nextGen > now) {
        
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
        
        continue;
      }

      // 生成処理
      try {
        const userSettings = await getUserSettings(userId);
        const ok = await generateAndAttachContent(userId, acct, sk.replace(/^SCHEDULEDPOST#/, ''), rec.theme || '', userSettings);
        if (ok) {
          generated++;
        } else {
          // dump full scheduled item and recent logs for debugging
          try {
            const full = await ddb.send(new GetItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: pk }, SK: { S: sk } } }));
            const item = unmarshall(full.Item || {});
          } catch (_) {}
          try {
            const q = await ddb.send(new QueryCommand({ TableName: TBL_LOGS, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)', ExpressionAttributeValues: { ':pk': { S: pk }, ':pfx': { S: 'LOG#' } }, Limit: 10, ScanIndexForward: false }));
            const logs = (q.Items || []).map(i => unmarshall(i));
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
  return { generated };
}

async function runFiveMinJobForUser(userId: any) {
  const settings = await getUserSettings(userId);
  if (settings.autoPost === "inactive") {
    return { userId, totalAuto: 0, totalReply: 0, totalTwo: 0, rateSkipped: 0, skipped: "master_off" };
  }

  const accounts = await getThreadsAccounts(userId);
  let totalAuto = 0, totalReply = 0, totalTwo = 0, rateSkipped = 0;
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
    } catch(_) {}

    const a = await runAutoPostForAccount(acct, userId, settings);

    const r = await runRepliesForAccount(acct, userId, settings);

    const t = await runSecondStageForAccount(acct, userId, settings, true);

    // 短期対応: 5分ジョブでも本文生成を少数処理する（安全策）
    try {
      const genRes = await processPendingGenerationsForAccount(userId, acct, 1);
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
  const metrics = formatNonZeroLine([
    { label: "自動投稿", value: totalAuto },
    { label: "リプ返信", value: totalReply },
    { label: "2段階投稿", value: totalTwo },
    { label: "失効(rate-limit)", value: rateSkipped },
  ], "every-5min");
  const content = metrics === "every-5min：実行なし" ? metrics : `**[定期実行レポート] ${now} (every-5min)**\n${metrics}`;
  await postDiscordLog({ userId, content });
  return { userId, totalAuto, totalReply, totalTwo, rateSkipped };
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

      // 削除対象を判定してThreads APIで削除を試みる（共通ユーティリティ経由、詳細ログ追加）
        try {
          // dynamic import workaround for monorepo path resolution in Lambda build
        let deleteThreadPost: any = null;
        try {
          // attempt to load from package name (might not exist in lambda build)
          // @ts-expect-error - optional package import, may not have types in this compilation context
          const pkgMod = await import("@autosnsflow/backend-core").catch(() => null);
          if (pkgMod && pkgMod.deleteThreadPost) deleteThreadPost = pkgMod.deleteThreadPost;
          else deleteThreadPost = null;
        } catch (e2) {
          deleteThreadPost = null;
        }

        // トークンハッシュを作成（ログにそのままトークンを出さない）
        const tokenHash = acct.oauthAccessToken ? crypto.createHash("sha256").update(acct.oauthAccessToken).digest("hex").slice(0, 12) : (acct.accessToken ? crypto.createHash("sha256").update(acct.accessToken).digest("hex").slice(0, 12) : "");
        
        let deleteResult: any = null;
        if (deleteThreadPost) {
          const tokenToUse = acct.oauthAccessToken || acct.accessToken || '';
          if (!tokenToUse) {
            // no token available, mark as error
            deleteResult = { ok: false, status: 0, body: 'no_token_available' };
          } else {
            if (deleteParent && postId) {
              deleteResult = await deleteThreadPost({ postId, accessToken: tokenToUse });
            }
            if (!deleteParent && secondId) {
              deleteResult = await deleteThreadPost({ postId: secondId, accessToken: tokenToUse });
            }
          }
        } else {
          // Could not load deleteThreadPost module; mark as skipped
          deleteResult = { ok: false, status: 0, body: 'deleteThreadPost module missing' };
        }

        // Delete result must be checked
        if (!deleteResult || !deleteResult.ok) {
          // 保存用だけputLogして上位catchへ投げる
          await putLog({ userId, type: "second-stage-delete", accountId: acct.accountId, targetId: sk, status: "error", message: "二段階投稿削除に失敗(HTTP)", detail: { whichFlagUsed: flagSource || 'unknown', deleteTarget: deleteParent ? 'parent' : 'second-stage', postId: postId || secondId || '', statusCode: deleteResult?.status || 0, bodySnippet: (deleteResult?.body || '').slice(0, 1000), accessTokenHash: tokenHash } });
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
        await putLog({ userId, type: "second-stage-delete", accountId: acct.accountId, targetId: sk, status: "error", message: "二段階投稿削除に失敗", detail: { error: String(e), whichFlagUsed: flagSource || 'unknown', deleteTarget: deleteParent ? 'parent' : 'second-stage', postId: postId || '', secondId: secondId || '' } });
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

// 指定ユーザーの予約投稿で、scheduledAt が 7 日以上前かつ未投稿のものを物理削除する
async function pruneOldScheduledPosts(userId: any) {
  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    // Use GSI if available for account-based queries, otherwise scan PK
    let lastKey: any = undefined;
    let totalDeleted = 0;
    // Per-Threads-account deletion limit to avoid large single-run deletes
    const perAccountLimit = Number(process.env.PER_ACCOUNT_PRUNE_LIMIT || 20);
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
          // NOTE: per request, do not filter by status or isDeleted — delete purely by scheduledAt age
          if (!scheduledAt) continue;
          if (scheduledAt <= sevenDaysAgo) {
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

// 指定ユーザーの実行ログ（ExecutionLogs）で、createdAt が 7 日以上前のものを削除する
async function pruneOldExecutionLogs(userId: any) {
  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    let lastKey: any = undefined;
    let totalDeleted = 0;
    do {
      const q = await ddb.send(new QueryCommand({
        TableName: TBL_LOGS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "LOG#" },
        },
        ProjectionExpression: "PK,SK,createdAt",
        Limit: 1000,
        ExclusiveStartKey: lastKey,
      }));

      for (const it of (q.Items || [])) {
        try {
          const createdAt = Number(it.createdAt?.N || 0);
          if (createdAt && createdAt <= sevenDaysAgo) {
            await ddb.send(new DeleteItemCommand({ TableName: TBL_LOGS, Key: { PK: it.PK, SK: it.SK } }));
            totalDeleted++;
          }
        } catch (e) {
          console.warn('[warn] prune log delete failed for item', e);
        }
      }

      lastKey = q.LastEvaluatedKey;
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

// Full-table prune helper: iterate all users and run pruneOldScheduledPosts
async function pruneOldScheduledPostsAll() {
  try {
    const userIds = await getActiveUserIds();
    let totalDeleted = 0;
    for (const uid of userIds) {
      const c = await pruneOldScheduledPosts(uid);
      totalDeleted += Number(c || 0);
    }
    return totalDeleted;
  } catch (e) {
    console.warn('[warn] pruneOldScheduledPostsAll failed:', e);
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
    // delegating to deletePostsForAccount (minimal log)
    const mod = await import('./lib/delete-posts-for-account');
    const res = await mod.deletePostsForAccount({ userId, accountId, limit });
    try { console.info('[info] deleteUpTo100PostsForAccount result', { userId, accountId, res }); } catch(_) {}
    return { deletedCount: res.deletedCount, remaining: res.remaining };
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
async function processDeletionQueueForUser(userId: any) {
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
        try { console.info('[info] invoking deleteUpTo100PostsForAccount', { ownerUserId, accountId, batchSize }); } catch(_) {}
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
  const iso = new Date(finishedAt).toISOString();
  if (job === "hourly") {
    const line = formatNonZeroLine([
      { label: "予約投稿作成 合計", value: totals.createdCount },
      { label: "返信取得 合計", value: totals.fetchedReplies },
      { label: "下書き生成", value: totals.replyDrafts },
      { label: "スキップ件数", value: totals.skippedAccounts },
      { label: "投稿削除 合計", value: totals.deletedCount || 0 },
    ]);
    return [
      `**[MASTER] 定期実行サマリ ${iso} (hourly)**`,
      `スキャンユーザー数: ${userTotal} / 実行成功: ${userSucceeded}`,
      line,
      `所要時間: ${durSec}s`
    ].join("\n");
  }

  if (job === "daily-prune" || job === "prune") {
    const totalRecords = Number(totals?.preFilterTotal || 0);
    const targetRecords = Number(totals?.candidates || 0);
    const deleted = Number(totals?.deleted || 0);
    const remaining = Math.max(0, targetRecords - deleted);
    const line = [
      `スキャンユーザー数: ${userTotal}`,
      `全レコード数: ${totalRecords}`,
      `対象レコード数: ${targetRecords}`,
      `削除済レコード数: ${deleted}`,
      `残対象レコード数: ${remaining}`,
    ].join(" / ");
    return [
      `**[MASTER] 定期実行サマリ ${iso} (daily-prune)**`,
      line,
      `所要時間: ${durSec}s`
    ].join("\n");
  }

  const line = formatNonZeroLine([
    { label: "自動投稿 合計", value: totals.totalAuto },
    { label: "リプ返信 合計", value: totals.totalReply },
    { label: "2段階投稿 合計", value: totals.totalTwo },
    { label: "失効(rate-limit) 合計", value: totals.rateSkipped },
  ]);
  return [
    `**[MASTER] 定期実行サマリ ${iso} (every-5min)**`,
    `スキャンユーザー数: ${userTotal} / 実行成功: ${userSucceeded}`,
    line,
    `所要時間: ${durSec}s`
  ].join("\n");
}
