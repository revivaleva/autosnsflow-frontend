import { createDynamoClient } from '@/lib/ddb';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import crypto from 'crypto';
const ddb = createDynamoClient();
// Prefer explicit execution logs table used by scheduled tasks, fallback to LOG_TBL or ExecutionLogs
const LOG_TBL = process.env.TBL_EXECUTION_LOGS || process.env.LOG_TBL || 'ExecutionLogs';
function ymd(d = new Date()) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
// Put a structured execution log. This is the canonical logging function used across the app.
export async function putLog(entry) {
    try {
        // guard non-error debug logs with ALLOW_DEBUG_EXEC_LOGS
        const allowDebug = (process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1');
        if (!allowDebug && entry.status && entry.status !== 'error' && entry.status !== 'warn') {
            // skip persisting informational/debug logs unless explicitly allowed
            return;
        }
        const now = new Date();
        const userId = entry.userId;
        const pk = userId ? `USER#${userId}` : `LOG#${ymd(now)}`;
        const sk = `LOG#${Date.now()}#${crypto.randomUUID()}`;
        const item = {
            PK: { S: pk },
            SK: { S: sk },
            action: { S: entry.action },
            createdAt: { N: String(Math.floor(now.getTime() / 1000)) },
            status: { S: entry.status || 'info' },
            message: { S: String(entry.message || '') },
            detail: { S: JSON.stringify(entry.detail || {}).slice(0, 35000) },
        };
        if (entry.accountId)
            item.accountId = { S: String(entry.accountId) };
        if (entry.initiatedBy)
            item.initiatedBy = { S: String(entry.initiatedBy) };
        if (typeof entry.deletedCount === 'number')
            item.deletedCount = { N: String(entry.deletedCount) };
        if (entry.targetId)
            item.targetId = { S: String(entry.targetId) };
        await ddb.send(new PutItemCommand({ TableName: LOG_TBL, Item: item }));
    }
    catch (e) {
        // never throw from logger
        console.warn('[putLog] failed', String(e));
    }
}
// Backwards-compatible helper: adapt legacy calls to structured putLog
export async function logEvent(type, detail = {}) {
    try {
        const entry = {
            userId: detail?.userId || detail?.user,
            accountId: detail?.accountId,
            action: type,
            status: detail?.status || 'info',
            message: detail?.message || '',
            detail,
            initiatedBy: detail?.initiatedBy,
            deletedCount: detail?.deletedCount,
            targetId: detail?.targetId,
        };
        await putLog(entry);
    }
    catch (e) {
        console.warn('[logEvent] adapter failed', String(e));
    }
}
