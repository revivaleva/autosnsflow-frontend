import { DynamoDBClient, GetItemCommand, UpdateItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const TOKENS_TABLE = process.env.TOKENS_TABLE || "LicenseTokens";
const TOKEN_EVENTS_TABLE = process.env.TOKEN_EVENTS_TABLE || "TokenEvents";
const LEASE_SECONDS = Number(process.env.LEASE_SECONDS || "7200");
const LOG_TTL_SECONDS = Number(process.env.LOG_TTL_SECONDS || String(7 * 24 * 3600));

const ddb = new DynamoDBClient({ region: REGION });

function nowSec() { return Math.floor(Date.now() / 1000); }
function jsonResp(status: number, body: any) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

export const handler = async (event: any = {}) => {
  try {
    const headers = (event.headers || {});
    const auth = (headers.Authorization || headers.authorization || "") as string;
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const body = event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {};
    const device_id = body?.device_id;
    if (!token || !device_id) return jsonResp(400, { ok: false, code: 'BAD_REQUEST', message: 'token and device_id required' });

    const getResp = await ddb.send(new GetItemCommand({ TableName: TOKENS_TABLE, Key: marshall({ token }) }));
    if (!getResp.Item) return jsonResp(401, { ok: false, code: 'INVALID_TOKEN' });
    const item = unmarshall(getResp.Item) as any;
    const now = nowSec();
    if (item.disabled) return jsonResp(423, { ok: false, code: 'TOKEN_DISABLED' });
    if (item.expires_at && Number(item.expires_at) > 0 && Number(item.expires_at) < now) return jsonResp(410, { ok: false, code: 'TOKEN_EXPIRED' });
    if (item.bound_device_id !== device_id) return jsonResp(403, { ok: false, code: 'BOUND_TO_OTHER' });

    const newLease = now + LEASE_SECONDS;
    await ddb.send(new UpdateItemCommand({ TableName: TOKENS_TABLE, Key: marshall({ token }), UpdateExpression: 'SET session_expires_at = :s, updated_at = :now', ExpressionAttributeValues: marshall({ ':s': newLease, ':now': now }) }));

    try { const log = { event_id: `${token}#${now}#heartbeat`, token, event_type: 'heartbeat', actor: device_id, ts: now, ttl: now + LOG_TTL_SECONDS }; await ddb.send(new PutItemCommand({ TableName: TOKEN_EVENTS_TABLE, Item: marshall(log) })); } catch (e) { console.warn('putLog failed', String(e)); }

    return jsonResp(200, { ok: true, code: 'OK', data: { token: item.token, remaining_quota: item.remaining_quota || 0, session_expires_at: newLease } });
  } catch (e: any) { console.error('heartbeat error', e); return jsonResp(500, { ok: false, code: 'SERVER_ERROR', message: String(e?.message || e) }); }
};



// ci-retry: 20251019T145258Z
