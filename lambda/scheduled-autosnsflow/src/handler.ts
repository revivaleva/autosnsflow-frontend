// /lambda/scheduled-autosnsflow/src/handler.ts
// 定期実行で予約投稿の作成・実投稿・返信処理・2段階投稿を行い、必要な通知と計測を行う。
// 本実装は Threads のみを対象とする（X/Twitter は扱わない）。

import { fetchThreadsAccounts } from "@autosnsflow/backend-core";
import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  ScanCommand,
  DescribeTableCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import crypto from "crypto";
import { unmarshall } from "@aws-sdk/util-dynamodb";

/// === テーブル名 ===
const TBL_SETTINGS   = "UserSettings";
const TBL_THREADS    = "ThreadsAccounts";
const TBL_SCHEDULED  = "ScheduledPosts";
const TBL_REPLIES    = "Replies";
const TBL_GROUPS     = "AutoPostGroups";
const TBL_LOGS       = "ExecutionLogs";
const TBL_USAGE      = "UsageCounters";

// 既定ユーザー（単体テスト用）
const USER_ID = "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";

const region = process.env.AWS_REGION || "ap-northeast-1";
const ddb = new DynamoDBClient({ region });

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
const GSI_SCH_BY_ACC_TIME = "GSI1"; // ScheduledPosts: accountId, scheduledAt
const GSI_POS_BY_ACC_TIME = "GSI2"; // ScheduledPosts: accountId, postedAt
const GSI_REPLIES_BY_ACC  = "GSI1"; // Replies: accountId, createdAt

/// ========== OpenAI 既定値 & プロンプト生成 ==========
const DEFAULT_OPENAI_MODEL = "gpt-3.5-turbo";
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

async function callOpenAIText({ apiKey, model, temperature, max_tokens, prompt }: any) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens,
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content?.trim() || "";
  return { text, usage: json?.usage || {} };
}

/// ========== Discord ==========
// Discord Webhook送信の独自実装
async function postDiscord(urls: string[], content: string) {
  if (!urls || urls.length === 0) {
    console.log("[info] Discord webhook URLが設定されていないため送信をスキップ");
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

      console.log(`[info] Discord webhook送信成功: ${url}`);
      return { success: true, url };
    } catch (error) {
      console.error(`[error] Discord webhook送信失敗: ${url}`, error);
      return { success: false, url, error: String(error) };
    }
  });

  const results = await Promise.allSettled(promises);
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const totalCount = urls.length;

  console.log(`[info] Discord webhook送信完了: ${successCount}/${totalCount} 成功`);
}

async function getDiscordWebhooks(userId = USER_ID) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
    })
  );
  const single = out.Item?.discordWebhook?.S;
  const list = (out.Item?.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean);
  const urls = single ? [single] : list;
  return urls;
}

async function postDiscordLog({ userId = USER_ID, content, isError = false }: any) {
  const { normal, error } = await getDiscordWebhookSets(userId);
  const urls = isError ? (error.length ? error : normal) : normal;
  await postDiscord(urls, content);
}

async function getDiscordWebhookSets(userId = USER_ID) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      ProjectionExpression: "discordWebhook, discordWebhooks, errorDiscordWebhook, errorDiscordWebhooks",
    })
  );
  const nSingle = out.Item?.discordWebhook?.S;
  const nList = (out.Item?.discordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean);
  const eSingle = out.Item?.errorDiscordWebhook?.S;
  const eList = (out.Item?.errorDiscordWebhooks?.L || []).map((x: any) => x.S).filter(Boolean);
  const normal = nSingle ? [nSingle, ...nList] : nList;
  const error = eSingle ? [eSingle, ...eList] : eList;
  return { normal, error };
}

/// ========== 設定・ユーザー ==========
async function getActiveUserIds() {
  let lastKey: any, ids: any[] = [];
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

async function getUserSettings(userId = USER_ID) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_SETTINGS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: "SETTINGS" } },
      ProjectionExpression:
        "doublePostDelay, autoPost, dailyOpenAiLimit, defaultOpenAiCost, openaiApiKey, selectedModel, masterPrompt, openAiTemperature, openAiMaxTokens, autoPostAdminStop",
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
  const model = out.Item?.selectedModel?.S || DEFAULT_OPENAI_MODEL;
  const masterPrompt = out.Item?.masterPrompt?.S || "";
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
    openAiTemperature,
    openAiMaxTokens,
  };
}

/// ========== OpenAI使用制限（1日200回相当。文章生成は1カウント） ==========
async function getOpenAiLimitForUser(userId = USER_ID) {
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

async function reserveOpenAiCredits(userId = USER_ID, cost = 1) {
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
async function getThreadsAccounts(userId = USER_ID) {
  let lastKey: any, items: any[] = [];
  do {
    const res: any = await ddb.send(
      new QueryCommand({
        TableName: TBL_THREADS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
        ExpressionAttributeValues: {
          ":pk": { S: `USER#${userId}` },
          ":pfx": { S: "ACCOUNT#" },
        },
        ProjectionExpression:
          "SK, displayName, autoPost, autoReply, secondStageContent, rateLimitUntil, autoGenerate, autoPostGroupId, #st, platform, accessToken, providerUserId",
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
    accessToken: i.accessToken?.S || "",
    providerUserId: i.providerUserId?.S || "",
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
      console.log(`[warn] 削除失敗: ${item.SK?.S}`, e);
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

async function createScheduledPost(userId: any, { acct, group, type, whenJst }: any) {
  const themeStr = (type === 1 ? group.theme1 : type === 2 ? group.theme2 : group.theme3) || "";
  const groupTypeStr = `${group.groupName}-自動投稿${type}`;
  const timeRange = (type === 1 ? group.time1 : type === 2 ? group.time2 : group.time3) || "";
  const id = crypto.randomUUID();
  const item = {
    PK: { S: `USER#${userId}` },
    SK: { S: `SCHEDULEDPOST#${id}` },
    scheduledPostId: { S: id },
    accountId: { S: acct.accountId },
    accountName: { S: acct.displayName || "" },
    autoPostGroupId: { S: groupTypeStr },
    theme: { S: themeStr },
    content: { S: "" },
    scheduledAt: { N: String(toEpochSec(whenJst)) },
    postedAt: { N: "0" },
    status: { S: "scheduled" },
    createdAt: { N: String(nowSec()) },
    isDeleted: { BOOL: false },
    timeRange: { S: timeRange },
  };
  await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));
  return { id, groupTypeStr, themeStr };
}

async function generateAndAttachContent(userId: any, acct: any, scheduledPostId: any, themeStr: any, settings: any) {
  try {
    if (!settings?.openaiApiKey) {
      await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "skip", message: "OpenAIキー未設定のため本文生成をスキップ" });
      return;
    }
    
    // 編集モーダルと共通化したプロンプト構築
    let prompt: string;
    if (settings.masterPrompt?.trim()) {
      // ユーザー設定のマスタープロンプトがある場合
      const policy = `【運用方針（masterPrompt）】\n${settings.masterPrompt}\n`;
      
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
          console.log("[warn] ペルソナ取得失敗:", e);
          personaText = "";
        }
      } else {
        console.log("[warn] accountIdが未設定のためペルソナ取得をスキップ");
      }
      
      prompt = `
${policy}
${personaText ? `【アカウントのペルソナ】\n${personaText}\n` : "【アカウントのペルソナ】\n(未設定)\n"}
【投稿テーマ】
${themeStr}

【指示】
上記の方針とペルソナ・テーマに従い、SNS投稿本文を日本語で1つだけ生成してください。
- 文末表現や語感はペルソナに合わせる
- 長すぎない（140〜220文字目安）
- 絵文字は多用しすぎない（0〜3個程度）
- ハッシュタグは不要
      `.trim();
    } else {
      // デフォルトプロンプトを使用
      prompt = buildMasterPrompt(themeStr, acct.displayName);
    }

    const { text } = await callOpenAIText({
      apiKey: settings.openaiApiKey,
      model: settings.model || DEFAULT_OPENAI_MODEL,
      temperature: settings.openAiTemperature ?? DEFAULT_OPENAI_TEMP,
      max_tokens: settings.openAiMaxTokens ?? DEFAULT_OPENAI_MAXTOKENS,
      prompt,
    });

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
          UpdateExpression: "SET content = :c",
          ExpressionAttributeValues: { ":c": { S: cleanText } },
        }));
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "ok", message: "本文生成を完了" });
      } else {
        await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "error", message: "生成されたテキストが不正です", detail: { originalText: text, cleanedText: cleanText } });
      }
    }
  } catch (e) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: scheduledPostId, status: "error", message: "本文生成に失敗", detail: { error: String(e) } });
  }
}

// 任意の実行ログ出力（テーブル未作成時は黙ってスキップ）
async function putLog({
  userId = USER_ID,
  type,
  accountId = "",
  targetId = "",
  status = "info",
  message = "",
  detail = {},
}: any) {
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
    console.log("[warn] putLog skipped:", String(error?.name || error));
  }
}

type EventLike = { userId?: string };

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || "c7e43ae8-0031-70c5-a8ec-0f7962ee250f";
const MASTER_DISCORD_WEBHOOK = process.env.MASTER_DISCORD_WEBHOOK || "";

/// ========== ハンドラ（5分＆毎時の分岐 + テストモード） ==========
export const handler = async (event: any = {}) => {
  const job = event?.job || "every-5min";

  if (job === "test") {
    const userId = event?.userId || process.env.USER_ID || USER_ID;
    const action = event.action || "";
    const accountId = event.accountId || null;

    const accounts = accountId
      ? [await getAccountById(userId, accountId)].filter(Boolean)
      : await getThreadsAccounts(userId);

    const settings = await getUserSettings(userId);
    const results: any[] = [];

    for (const acct of accounts) {
      if (!acct) continue; // nullチェック追加
      try {
        switch (action) {
          case "ensureNextDay": {
            const r = await ensureNextDayAutoPosts(userId, acct);
            results.push({ accountId: acct.accountId, ensureNextDay: r });
            break;
          }
          case "runAutoPost": {
            const r = await runAutoPostForAccount(acct, userId, settings);
            results.push({ accountId: acct.accountId, runAutoPost: r });
            break;
          }
          case "fetchReplies": {
            const r = await fetchIncomingReplies(userId, acct);
            results.push({ accountId: acct.accountId, fetchReplies: r });
            break;
          }
          case "runReplies": {
            const r = await runRepliesForAccount(acct, userId, settings);
            results.push({ accountId: acct.accountId, runReplies: r });
            break;
          }
          case "runSecondStage": {
            const r = await runSecondStageForAccount(acct, userId, settings);
            results.push({ accountId: acct.accountId, runSecondStage: r });
            break;
          }
          case "createOneOff": {
            const r = await createOneOffForTest({
              userId, acct,
              minutesFromNow: Number(event.minutesFromNow ?? 1),
              windowMinutes: Number(event.windowMinutes ?? 10),
              theme: event.theme || "テスト投稿",
              content: event.content || "",
            });
            results.push({ accountId: acct.accountId, createOneOff: r });
            break;
          }
          case "getAccount": {
            // 取得済み acct をそのまま返す（accountId を指定すれば1件、無指定なら全件ループで返る）
            results.push({ accountId: acct.accountId, account: acct });
            break;
          }
          default:
            results.push({ accountId: acct?.accountId || "-", error: "unknown action" });
        }
      } catch (e) {
        await postDiscordLog({
          userId,
          isError: true,
          content: `**[TEST ERROR ${action}] ${acct?.displayName || acct?.accountId || "-"}**\n${String(e).slice(0, 800)}`
        });
        results.push({ accountId: acct?.accountId || "-", error: String(e) });
      }
    }
    return { statusCode: 200, body: JSON.stringify({ action, userId, results }) };
  }

  // === 集計用の開始時刻 ===
  const startedAt = Date.now();

  if (job === "hourly") {
    const userIds = await getActiveUserIds();
    let userSucceeded = 0;
    const totals = { createdCount: 0, fetchedReplies: 0, replyDrafts: 0, skippedAccounts: 0 };

    for (const uid of userIds) {
      try {
        const r = await runHourlyJobForUser(uid);
        // ……合算……
        userSucceeded++;
      } catch (e) {
        console.log("hourly error for", uid, e);
        await postDiscordLog({
          userId: uid,
          isError: true,
          content: `**[ERROR hourly] user=${uid}**\n${String(e).slice(0, 800)}`
        });
      }
    }

    const finishedAt = Date.now();
    await postDiscordMaster(
      formatMasterMessage({
        job: "hourly",
        startedAt,
        finishedAt,
        userTotal: userIds.length,
        userSucceeded,
        totals
      })
    );

    return { statusCode: 200, body: JSON.stringify({ processedUsers: userIds.length, userSucceeded, totals }) };
  }

  // every-5min（デフォルト）
  const userIds = await getActiveUserIds();
  let userSucceeded = 0;
  const totals = { totalAuto: 0, totalReply: 0, totalTwo: 0, rateSkipped: 0 };

  for (const uid of userIds) {
    try {
      const r = await runFiveMinJobForUser(uid);
      // ……合算……
      userSucceeded++;
    } catch (e) {
      console.log("5min error for", uid, e);
      await postDiscordLog({
        userId: uid,
        isError: true,
        content: `**[ERROR every-5min] user=${uid}**\n${String(e).slice(0, 800)}`
      });
    }
  }

  const finishedAt = Date.now();
  await postDiscordMaster(
    formatMasterMessage({
      job: "every-5min",
      startedAt,
      finishedAt,
      userTotal: userIds.length,
      userSucceeded,
      totals
    })
  );

  return { statusCode: 200, body: JSON.stringify({ processedUsers: userIds.length, userSucceeded, totals }) };
};

/// ========== テスト用補助関数 ==========
async function getAccountById(userId: any, accountId: any) {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TBL_THREADS,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `ACCOUNT#${accountId}` } },
      ProjectionExpression:
        "SK, displayName, autoPost, autoReply, secondStageContent, rateLimitUntil, autoGenerate, autoPostGroupId, #st, platform, accessToken, providerUserId",
      ExpressionAttributeNames: { "#st": "status" },
    })
  );
  const i = out.Item;
  if (!i) return null;
  return {
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
    accessToken: i.accessToken?.S || "",
    providerUserId: i.providerUserId?.S || "",
  };
}

// "今+Δ分" に 1 本だけの予約を作る（グループ不要）
async function createOneOffForTest({
  userId,
  acct,
  minutesFromNow = 1,
  windowMinutes = 10,
  theme = "テスト投稿",
  content = "",
}: any) {
  const base = jstNow();
  const when = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    base.getHours(),
    base.getMinutes() + minutesFromNow,
    0
  );
  const hhmm = (d: any) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const range = `${hhmm(base)}-${hhmm(new Date(base.getTime() + windowMinutes * 60 * 1000))}`;

  const fakeGroup = {
    groupName: "テスト",
    theme1: theme,
    time1: range,
    time2: "",
    time3: "",
  };
  const { id } = await createScheduledPost(userId, {
    acct,
    group: fakeGroup,
    type: 1,
    whenJst: when,
  });

  if (content) {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TBL_SCHEDULED,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${id}` } },
        UpdateExpression: "SET content = :c",
        ExpressionAttributeValues: { ":c": { S: content } },
      })
    );
  }
  return { scheduledPostId: id, timeRange: range, scheduledAt: when.toISOString() };
}

// Threads の user-id を取得して ThreadsAccounts に保存
async function fetchProviderUserIdFromPlatform(acct: any) {
  const url = new URL("https://graph.threads.net/v1.0/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", acct.accessToken);
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Threads get me error: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  return json?.id || "";
}

// DB更新つきの user-id 取得ラッパ
async function ensureProviderUserId(userId: any, acct: any) {
  if (acct?.providerUserId) return acct.providerUserId;
  if (!acct?.accessToken) return "";

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
        responseContent = generatedReply || "";
      } catch (e) {
        console.log(`[warn] 返信コンテンツ生成失敗: ${String(e)}`);
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
      ProjectionExpression: "postId, content, postedAt",
      Limit: 3,
    }));
  } catch (e) {
    if (!isGsiMissing(e)) throw e;
    console.log("[warn] GSI2 missing on ScheduledPosts. fallback to PK Query");
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
      ProjectionExpression: "postId, content, postedAt",
      Limit: 3,
    }));
  }

  const posts = (q.Items || []).map((i: any) => ({
    postId: i.postId?.S,
    content: i.content?.S || "",
    postedAt: i.postedAt?.N ? Number(i.postedAt.N) : 0,
  })).filter(p => p.postId);
  
  let saved = 0;

  for (const post of posts) {
    const url = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(post.postId)}/replies`);
    url.searchParams.set("access_token", acct.accessToken);
    const r = await fetch(url.toString());
    if (!r.ok) { 
      await putLog({ 
        userId, type: "reply-fetch", accountId: acct.accountId, 
        status: "error", message: `Threads replies error: ${r.status}` 
      }); 
      continue; 
    }
    const json = await r.json();
    for (const rep of (json?.data || [])) {
      const externalReplyId = String(rep.id);
      const text = rep.text || "";
      const createdAt = nowSec();
      const ok = await upsertReplyItem(userId, acct, { 
        externalReplyId, 
        postId: post.postId, 
        text, 
        createdAt,
        originalPost: post
      });
      if (ok) saved++;
    }
  }
  await putLog({ userId, type: "reply-fetch", accountId: acct.accountId, status: "ok", message: `Threads: 返信を ${saved} 件保存` });
  return { saved };
}

async function fetchIncomingReplies(userId: any, acct: any) {
  if (!acct.autoReply) return { fetched: 0 };
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

  const today = jstNow();
  const settings = await getUserSettings(userId);

  let created = 0;
  let deleted = 0;
  // ← ここにタイプ毎の判定結果を積んで、最後に ExecutionLogs にまとめて出します
  const debug: any[] = [];

  // ★実績チェック（isPostedToday）は廃止：投稿がまだ無くても翌日分を作る
  for (const type of [1, 2, 3]) {
    const groupTypeStr = `${group.groupName}-自動投稿${type}`;
    const timeRange =
      (type === 1 ? group.time1 : type === 2 ? group.time2 : group.time3) || "";

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 既に明日分があるか？
    const exists = await existsForDate(userId, acct, groupTypeStr, tomorrow);

    // 途中経過トレース
    const trace: any = { type, groupTypeStr, timeRange, exists };
    
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
    const when = randomTimeInRangeJst(timeRange, today, true);
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
    const { id, themeStr } = await createScheduledPost(userId, {
      acct, group, type, whenJst: when
    });
    await generateAndAttachContent(userId, acct, id, themeStr, settings);

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
async function postToThreads({ accessToken, text, userIdOnPlatform, inReplyTo = undefined }: any) {
  if (!accessToken) throw new Error("Threads accessToken 未設定");
  if (!userIdOnPlatform) throw new Error("Threads userId 未設定");

  const base = `https://graph.threads.net/v1.0/${encodeURIComponent(userIdOnPlatform)}`;

  // --- コンテナ作成（GAS と同じ：media_type は必須） ---
  // GAS 側と同じく TEXT 投稿。返信のときは replied_to_id を付与
  const createPayload: any = {
    media_type: "TEXT",
    text,
    access_token: accessToken,
  };
  if (inReplyTo) {
    // ※GAS と同じキー名。万一 API 変更でエラーになったら下のフォールバックが動きます
    createPayload.replied_to_id = inReplyTo;
  }

  let createRes = await fetch(`${base}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createPayload),
  });

  // フォールバック（ドキュメント差異対策）
  if (!createRes.ok && inReplyTo) {
    // 一部資料では reply_to_id / parent_id の表記があるため順に試す
    const errText = await createRes.text().catch(() => "");
    // reply_to_id で再試行
    const altPayload1 = { ...createPayload };
    delete altPayload1.replied_to_id;
    altPayload1.reply_to_id = inReplyTo;

    let retried = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(altPayload1),
    });

    if (!retried.ok) {
      // parent_id でさらに再試行
      const altPayload2 = { ...createPayload };
      delete altPayload2.replied_to_id;
      altPayload2.parent_id = inReplyTo;

      retried = await fetch(`${base}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(altPayload2),
      });

      if (!retried.ok) {
        const err2 = await retried.text().catch(() => "");
        throw new Error(
          `Threads create error: first=${createRes.status} ${errText} / retry=${retried.status} ${err2}`
        );
      }
    }
    createRes = retried;
  }

  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    throw new Error(`Threads create error: ${createRes.status} ${t}`);
  }

  const createJson = await createRes.json().catch(() => ({}));
  const creation_id = createJson?.id;
  if (!creation_id) throw new Error("Threads creation_id 取得失敗");

  // --- 公開（GAS と同じ） ---
  const pubRes = await fetch(`${base}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id, access_token: accessToken }),
  });
  if (!pubRes.ok) {
    const t = await pubRes.text().catch(() => "");
    throw new Error(`Threads publish error: ${pubRes.status} ${t}`);
  }
  const pubJson = await pubRes.json().catch(() => ({}));
  return { postId: pubJson?.id || creation_id };
}

/// ========== 5分ジョブ（実投稿・返信送信・2段階投稿） ==========
// 5分ジョブ：実投稿
async function runAutoPostForAccount(acct: any, userId = USER_ID, settings: any = undefined) {
  if (!acct.autoPost) return { posted: 0 };
  if (acct.status && acct.status !== "active") {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, status: "skip", message: `status=${acct.status} のためスキップ` });
    return { posted: 0 };
  }

  // まず "未投稿・時刻到来" の予約を1件取得（GSI→PKフォールバック）
  // 方式B: GSIはキーだけを取得（Filterしない）→ 本体をGetItemで精査
  const q = await ddb.send(new QueryCommand({
    TableName: TBL_SCHEDULED,
    IndexName: GSI_SCH_BY_ACC_TIME,
    KeyConditionExpression: "accountId = :acc AND scheduledAt <= :now",
    ExpressionAttributeValues: {
      ":acc": { S: acct.accountId },
      ":now": { N: String(nowSec()) },
    },
    // Keys only でも動くように PK/SK と scheduledAt だけ取得
    ProjectionExpression: "PK, SK, scheduledAt",
    ScanIndexForward: true, // 古い順に見る
    Limit: 10               // 念のため複数拾って精査
  }));

  let cand = null;
  for (const it of (q.Items || [])) {
    const pk = it.PK.S;
    const sk = it.SK.S;

    // 本体を取得して status/postedAt/timeRange を確認
    const full = await ddb.send(new GetItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: pk }, SK: { S: sk } },
      ProjectionExpression: "content, postedAt, timeRange, scheduledAt, autoPostGroupId, #st",
      ExpressionAttributeNames: { "#st": "status" }
    }));
    const x = unmarshall(full.Item || {});
    const postedZero = !x.postedAt || x.postedAt === 0 || x.postedAt === "0";
    const stOK = (x.status || "") === "scheduled";

    // timeRange がある場合は失効チェック
    const notExpired = !x.timeRange || (() => {
      const endJst = rangeEndOfDayJst(x.timeRange, jstFromEpoch(Number(x.scheduledAt || 0)));
      return !endJst || nowSec() <= toEpochSec(endJst);
    })();

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
      break;
    }
  }

  // 候補が無ければ今回は投稿なし
  if (!cand) return { posted: 0 };

  // 以降の処理で使う値（従来の q.Items[0] 由来の値を置き換える）
  const pk = cand.pk;
  const sk = cand.sk;
  const text = (cand as any).content || "";
  const range = (cand as any).timeRange || "";
  const scheduledAtSec = Number((cand as any).scheduledAt || 0);

  // 本文が空ならスキップ（次回リトライ）
  if (!text) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "skip", message: "本文が未生成のためスキップ" });
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
  if (!acct.accessToken) {
    await putLog({ userId, type: "auto-post", accountId: acct.accountId, targetId: sk, status: "error", message: "Threadsのアクセストークン未設定" });
    return { posted: 0 };
  }

  // 実投稿 → 成功時のみ posted に更新（冪等）
  try {
    const { postId } = await postToThreads({
      accessToken: acct.accessToken,
      text,
      userIdOnPlatform: acct.providerUserId,
    });

    await ddb.send(new UpdateItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: pk }, SK: { S: sk } },
      UpdateExpression: "SET #st = :posted, postedAt = :ts, postId = :pid",
      ConditionExpression: "#st = :scheduled",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":posted":   { S: "posted" },
        ":scheduled":{ S: "scheduled" },
        ":ts":       { N: String(nowSec()) },
        ":pid":      { S: postId || "" },
      },
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
async function runRepliesForAccount(acct: any, userId = USER_ID, settings: any = undefined) {
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
    console.log("[warn] GSI1 missing on Replies. fallback to PK Query");
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
      const parentId = externalReplyId || (it.postId?.S || "");

      try {
        const { postId: respId } = await postToThreads({
          accessToken: acct.accessToken,
          text,
          userIdOnPlatform: acct.providerUserId,
          inReplyTo: parentId
        });
        await ddb.send(new UpdateItemCommand({
          TableName: TBL_REPLIES,
          Key: { PK: { S: it.PK.S }, SK: { S: it.SK.S } },
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
async function runSecondStageForAccount(acct: any, userId = USER_ID, settings: any = undefined) {
  const delayMin = settings?.doublePostDelayMinutes ?? 0;
  if (!acct.secondStageContent || delayMin <= 0) return { posted2: 0 };

  const threshold = nowSec() - delayMin * 60;

  let q;
  try {
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      IndexName: GSI_POS_BY_ACC_TIME,
      KeyConditionExpression: "accountId = :acc AND postedAt <= :th",
      FilterExpression:
        "(attribute_not_exists(doublePostStatus) OR doublePostStatus <> :done) AND #st = :posted AND contains(autoPostGroupId, :auto)",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":acc":    { S: acct.accountId },
        ":th":     { N: String(threshold) },
        ":done":   { S: "done" },
        ":posted": { S: "posted" },
        ":auto":   { S: "自動投稿" }
      },
      ProjectionExpression: "PK, SK, postId",
      Limit: 1
    }));
  } catch (e) {
    if (!isGsiMissing(e)) throw e;
    console.log("[warn] GSI2 missing on ScheduledPosts. fallback to PK Query");
    q = await ddb.send(new QueryCommand({
      TableName: TBL_SCHEDULED,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :pfx)",
      ExpressionAttributeValues: {
        ":pk":     { S: `USER#${userId}` },
        ":pfx":    { S: "SCHEDULEDPOST#" },
        ":acc":    { S: acct.accountId },
        ":th":     { N: String(threshold) },
        ":done":   { S: "done" },
        ":posted": { S: "posted" },
        ":auto":   { S: "自動投稿" }
      },
      FilterExpression:
        "accountId = :acc AND postedAt <= :th AND (attribute_not_exists(doublePostStatus) OR doublePostStatus <> :done) AND #st = :posted AND contains(autoPostGroupId, :auto)",
      ExpressionAttributeNames: { "#st": "status" },
      ProjectionExpression: "PK, SK, postId",
      Limit: 1
    }));
  }

  if (!q.Items || q.Items.length === 0) return { posted2: 0 };

  const pk = q.Items[0].PK.S;
  const sk = q.Items[0].SK.S;
  const firstPostId = q.Items[0].postId?.S || "";

  // Threads のユーザーIDが未取得であれば取得
  if (!acct.providerUserId) {
    const pid = await ensureProviderUserId(userId, acct);
    if (!pid) {
      await putLog({ userId, type: "second-stage", accountId: acct.accountId, targetId: sk, status: "skip", message: "ThreadsのユーザーID未取得のためスキップ" });
      return { posted2: 0 };
    }
  }

  try {
    const text2 = acct.secondStageContent;
    const { postId: pid2 } = await postToThreads({ accessToken: acct.accessToken, text: text2, userIdOnPlatform: acct.providerUserId, inReplyTo: firstPostId });
    await ddb.send(new UpdateItemCommand({
      TableName: TBL_SCHEDULED,
      Key: { PK: { S: pk }, SK: { S: sk } },
      UpdateExpression: "SET doublePostStatus = :done, secondStagePostId = :pid, secondStageAt = :ts",
      ConditionExpression: "attribute_not_exists(doublePostStatus) OR doublePostStatus <> :done",
      ExpressionAttributeValues: { ":done": { S: "done" }, ":pid": { S: pid2 || `DUMMY2-${crypto.randomUUID()}` }, ":ts": { N: String(nowSec()) } }
    }));
    await putLog({ userId, type: "second-stage", accountId: acct.accountId, targetId: sk, status: "ok", message: "2段階投稿を完了" });
    return { posted2: 1 };
  } catch (e) {
    await putLog({ userId, type: "second-stage", accountId: acct.accountId, targetId: sk, status: "error", message: "2段階投稿に失敗", detail: { error: String(e) } });
    await postDiscordLog({
      userId,
      isError: true,
      content: `**[ERROR second-stage] ${acct.displayName || acct.accountId}**\n${String(e).slice(0, 800)}`
    });
    return { posted2: 0 };
  }
}

/// ========== ユーザー単位の実行ラッパー ==========
async function runHourlyJobForUser(userId: any) {
  const settings = await getUserSettings(userId);
  if (settings.autoPost === "inactive") {
    return { userId, createdCount: 0, replyDrafts: 0, fetchedReplies: 0, skippedAccounts: 0, skipped: "master_off" };
  }
  const accounts = await getThreadsAccounts(userId);

  let createdCount = 0;
  let fetchedReplies = 0;
  let replyDrafts = 0;
  let skippedAccounts = 0;

  for (const acct of accounts) {
    const c = await ensureNextDayAutoPosts(userId, acct);
    createdCount += c.created || 0;
    if (c.skipped) skippedAccounts++;

    try {
      const fr = await fetchIncomingReplies(userId, acct);
      fetchedReplies += fr.fetched || 0;
    } catch (e) {
      await putLog({ userId, type: "reply-fetch", accountId: acct.accountId, status: "error", message: "返信取得失敗", detail: { error: String(e) } });
    }
  }

  const urls = await getDiscordWebhooks(userId);
  const now = new Date().toISOString();
  await postDiscordLog({
    userId,
    content: `**[定期実行レポート] ${now} (hourly)**\n予約投稿作成: ${createdCount} 件 / 返信取得: ${fetchedReplies} 件 / 返信下書き: ${replyDrafts} 件 / スキップ: ${skippedAccounts}`
  });
  return { userId, createdCount, fetchedReplies, replyDrafts, skippedAccounts };
}

async function runFiveMinJobForUser(userId: any) {
  const settings = await getUserSettings(userId);
  if (settings.autoPost === "inactive") {
    return { userId, totalAuto: 0, totalReply: 0, totalTwo: 0, rateSkipped: 0, skipped: "master_off" };
  }

  const accounts = await getThreadsAccounts(userId);
  let totalAuto = 0, totalReply = 0, totalTwo = 0, rateSkipped = 0;

  for (const acct of accounts) {
    const a = await runAutoPostForAccount(acct, userId, settings);
    const r = await runRepliesForAccount(acct, userId, settings);
    const t = await runSecondStageForAccount(acct, userId, settings);

    totalAuto += a.posted || 0;
    totalReply += r.replied || 0;
    totalTwo += t.posted2 || 0;

    if (a.skipped === "window_expired") rateSkipped++;
  }

  const urls = await getDiscordWebhooks(userId);
  const now = new Date().toISOString();
  await postDiscordLog({
    userId,
    content: `**[定期実行レポート] ${now} (every-5min)**\n自動投稿: ${totalAuto} / リプ返信: ${totalReply} / 2段階投稿: ${totalTwo} / 失効(rate-limit): ${rateSkipped}`
  });
  return { userId, totalAuto, totalReply, totalTwo, rateSkipped };
}

/// ========== マスタ通知（集計サマリ） ==========
function getMasterWebhookUrl() {
  return process.env.MASTER_DISCORD_WEBHOOK || process.env.DISCORD_MASTER_WEBHOOK || "";
}

async function postDiscordMaster(content: any) {
  const url = getMasterWebhookUrl();
  if (!url) {
    console.log("[info] MASTER_DISCORD_WEBHOOK 未設定のためマスタ通知スキップ");
    return;
  }
  try {
    await postDiscord([url], content);
  } catch (e) {
    console.log("[warn] master discord post failed:", String(e));
  }
}

function formatMasterMessage({ job, startedAt, finishedAt, userTotal, userSucceeded, totals }: any) {
  const durMs = finishedAt - startedAt;
  const durSec = Math.max(1, Math.round(durMs / 1000));
  const iso = new Date(finishedAt).toISOString();
  if (job === "hourly") {
    return [
      `**[MASTER] 定期実行サマリ ${iso} (hourly)**`,
      `スキャンユーザー数: ${userTotal} / 実行成功: ${userSucceeded}`,
      `予約投稿作成 合計: ${totals.createdCount} / 返信取得 合計: ${totals.fetchedReplies} / 下書き生成: ${totals.replyDrafts} / スキップ件数: ${totals.skippedAccounts}`,
      `所要時間: ${durSec}s`
    ].join("\n");
  }
  return [
    `**[MASTER] 定期実行サマリ ${iso} (every-5min)**`,
    `スキャンユーザー数: ${userTotal} / 実行成功: ${userSucceeded}`,
    `自動投稿 合計: ${totals.totalAuto} / リプ返信 合計: ${totals.totalReply} / 2段階投稿 合計: ${totals.totalTwo} / 失効(rate-limit) 合計: ${totals.rateSkipped}`,
    `所要時間: ${durSec}s`
  ].join("\n");
}
