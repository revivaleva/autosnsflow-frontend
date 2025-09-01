import type { NextApiRequest, NextApiResponse } from 'next';
import { QueryCommand, PutItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@/lib/ddb';
import { verifyUserFromRequest } from '@/lib/auth';
import crypto from 'crypto';

const ddb = createDynamoClient();
const TBL_SCHEDULED = process.env.TBL_SCHEDULED_POSTS || 'ScheduledPosts';
const TBL_ACCOUNTS = process.env.TBL_THREADS_ACCOUNTS || 'ThreadsAccounts';
const TBL_GROUPS = process.env.TBL_AUTO_POST_GROUPS || 'AutoPostGroups';

// helper: epoch seconds for start/end of today JST
function todayRangeJst() {
  const d = new Date();
  // convert to JST by offset +9
  const jstOffset = 9 * 60; // minutes
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const jst = new Date(utc + jstOffset * 60000);
  jst.setHours(0,0,0,0);
  const t0 = Math.floor(jst.getTime() / 1000);
  const t1 = Math.floor((new Date(jst.getTime() + 24*3600*1000 - 1)).getTime() / 1000);
  return { t0, t1 };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const user = await verifyUserFromRequest(req);
    const userId = user.sub;

    // 1) 取得すべきアカウント一覧（自動投稿が有効なアカウント）
    // オプションでリクエストボディに accountIds が含まれていたらそれを優先
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const requestedIds: string[] = Array.isArray(body?.accountIds) ? body.accountIds.map(String) : [];

    const accs = await ddb.send(new QueryCommand({
      TableName: TBL_ACCOUNTS,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'ACCOUNT#' } },
    }));

    let accounts = (accs.Items || []).map((it: any) => ({
      accountId: it.SK?.S?.replace(/^ACCOUNT#/, '') || '',
      accountName: it.displayName?.S || '',
      autoPostGroupId: it.autoPostGroupId?.S || '',
      autoGenerate: it.autoGenerate?.BOOL === true,
    })).filter(a => a.autoGenerate && a.autoPostGroupId);

    if (requestedIds.length) {
      accounts = accounts.filter(a => requestedIds.includes(a.accountId));
    }

    const { t0, t1 } = todayRangeJst();
    let created = 0;

    for (const acct of accounts) {
      // 2) そのアカウントの自動投稿グループのスロットを取得
      const gq = await ddb.send(new QueryCommand({
        TableName: TBL_GROUPS,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: `GROUPITEM#${acct.autoPostGroupId}#` } },
      }));
      const slots = (gq.Items || []).map((it: any) => ({
        slotId: (it.SK?.S || '').split('#').pop(),
        timeRange: it.timeRange?.S || '',
        theme: it.theme?.S || '',
        enabled: it.enabled?.BOOL === true,
      })).filter(s => s.enabled);

      if (!slots.length) continue;

      // fetch group metadata to get groupName for display (groupKey -> groupName mapping)
      let groupName = acct.autoPostGroupId || '';
      try {
        const gItem = await ddb.send(new GetItemCommand({ TableName: TBL_GROUPS, Key: { PK: { S: `USER#${userId}` }, SK: { S: acct.autoPostGroupId } }, ProjectionExpression: 'groupName' }));
        if (gItem.Item?.groupName?.S) groupName = gItem.Item.groupName.S;
      } catch (e) {
        // ignore, keep groupName as is
      }

      // 3) 当日の既存自動投稿の有無をチェック（accountId + autoPostGroupId + scheduledAt の範囲）
      // 簡易的に scheduledAt BETWEEN t0..t1 AND accountId = acct.accountId AND begins_with(autoPostGroupId, acct.autoPostGroupId)
      // Use Query + FilterExpression
      const existed = await ddb.send(new QueryCommand({
        TableName: TBL_SCHEDULED,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':pfx': { S: 'SCHEDULEDPOST#' }, ':acc': { S: acct.accountId }, ':grp': { S: acct.autoPostGroupId }, ':t0': { N: String(t0) }, ':t1': { N: String(t1) } },
        FilterExpression: 'accountId = :acc AND begins_with(autoPostGroupId, :grp) AND scheduledAt BETWEEN :t0 AND :t1',
        ProjectionExpression: 'PK, SK',
      }));

      const existCount = (existed.Items || []).length;
      if (existCount > 0) continue; // 既に作成済みならスキップ

      // 4) スロット分だけ新規予約を作成（スロットの timeRange も利用できるがここでは scheduledAt をスロットに依らず JST のランダム時間に設定）
      for (let si = 0; si < slots.length; si++) {
        const slot = slots[si];
        const id = crypto.randomUUID();
        // scheduledAt をスロットの timeRange に基づいて割り当てる
        // timeRange 形式: "HH:MM-HH:MM" 例: "05:00-08:00"
        function parseRangeToEpoch(range: string) {
          try {
            const parts = (range || "").split('-').map(s => s.trim());
            if (parts.length !== 2) return null;
            const [a, b] = parts;
            const pa = a.split(':').map(x => parseInt(x, 10));
            const pb = b.split(':').map(x => parseInt(x, 10));
            if (pa.length < 2 || pb.length < 2) return null;
            // 今日の JST 日付の 00:00 を取得
            const now = new Date();
            const utc = now.getTime() + now.getTimezoneOffset() * 60000;
            const jstOffset = 9 * 60; // minutes
            const jstMid = new Date(utc + jstOffset * 60000);
            jstMid.setHours(0,0,0,0);
            const dateY = jstMid.getFullYear();
            const dateM = jstMid.getMonth();
            const dateD = jstMid.getDate();
            const ta = new Date(Date.UTC(dateY, dateM, dateD, pa[0]-9, pa[1], 0));
            const tb = new Date(Date.UTC(dateY, dateM, dateD, pb[0]-9, pb[1], 0));
            // If end <= start, treat as single point at start
            const mid = Math.floor((ta.getTime() + tb.getTime()) / 2);
            return Math.floor(mid / 1000);
          } catch (e) {
            return null;
          }
        }

        let scheduledAt = null as number | null;
        if (slot.timeRange) {
          const v = parseRangeToEpoch(slot.timeRange);
          if (v) scheduledAt = v;
        }
        if (!scheduledAt) {
          // フォールバック: 本日12:00 JST
          const now = new Date();
          const utc = now.getTime() + now.getTimezoneOffset() * 60000;
          const jstOffset = 9 * 60; // minutes
          const jst = new Date(utc + jstOffset * 60000);
          jst.setHours(12,0,0,0);
          scheduledAt = Math.floor(jst.getTime() / 1000);
        }
        const typeIndex = si + 1;
        const groupTypeStr = `${groupName}-自動投稿${typeIndex}`;

        const item: any = {
          PK: { S: `USER#${userId}` },
          SK: { S: `SCHEDULEDPOST#${id}` },
          scheduledPostId: { S: id },
          accountId: { S: acct.accountId },
          accountName: { S: acct.accountName || '' },
          autoPostGroupId: { S: groupTypeStr },
          theme: { S: slot.theme || '' },
          content: { S: '' },
          scheduledAt: { N: String(scheduledAt) },
          postedAt: { N: '0' },
          status: { S: 'scheduled' },
          isDeleted: { BOOL: false },
          createdAt: { N: String(Math.floor(Date.now() / 1000)) },
          timeRange: { S: slot.timeRange || '' },
        };
        await ddb.send(new PutItemCommand({ TableName: TBL_SCHEDULED, Item: item }));
        created++;

        // 5) その場で AI 生成して content を更新（非同期でもよいがここでは同期実行）
        try {
          // call internal AI API to generate post text
          // If theme contains commas, pick one randomly server-side
          let themeForAI = slot.theme || '';
          if (typeof themeForAI === 'string' && themeForAI.includes(',')) {
            const parts = themeForAI.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length > 0) themeForAI = parts[Math.floor(Math.random() * parts.length)];
          }
          // Build a richer prompt to avoid AI echoing back the theme only
          const aiPrompt = `# テーマ\n${themeForAI}\n\n# 指示\n以下のテーマをもとに、Threads投稿用の短い本文（日本語、約80-140文字）を1つ作成してください。\n- アカウントのペルソナに合わせた自然な口調で\n- 絵文字を適度に使用して親しみやすく\n- 返信を促す要素を1つ含める\n出力は本文のテキストのみとしてください。`;

          const aiResp = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/ai-gateway`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purpose: 'post-generate', input: { accountId: acct.accountId, theme: themeForAI, prompt: aiPrompt } }),
          });
          const aiData = await aiResp.json().catch(() => ({}));
          let text = aiData.text || aiData?.raw?.choices?.[0]?.message?.content || '';
          if (!text) text = themeForAI || '（自動生成に失敗しました）';
          // Update item with generated content
          await ddb.send(new UpdateItemCommand({ TableName: TBL_SCHEDULED, Key: { PK: { S: `USER#${userId}` }, SK: { S: `SCHEDULEDPOST#${id}` } }, UpdateExpression: 'SET content = :c', ExpressionAttributeValues: { ':c': { S: String(text) } } }));
        } catch (e) {
          // ignore per-account generation errors
          console.log('ai generate failed for', acct.accountId, e);
        }
      }
    }

    return res.status(200).json({ ok: true, created });
  } catch (e: any) {
    console.error('create-today error', e);
    return res.status(500).json({ error: String(e) });
  }
}


