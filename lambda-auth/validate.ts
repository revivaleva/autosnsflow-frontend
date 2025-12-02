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
    const device_info = body?.device_info || null;
    const current_container_count = body?.current_container_count ?? null;

    if (!token || !device_id) return jsonResp(400, { ok: false, code: 'BAD_REQUEST', message: 'token and device_id required' });

    // Use table primary key `token_id` (stored as plain token per current DB)
    const getResp = await ddb.send(new GetItemCommand({ TableName: TOKENS_TABLE, Key: marshall({ token_id: token }) }));
    if (!getResp.Item) return jsonResp(401, { ok: false, code: 'INVALID_TOKEN', message: 'token not found' });
    let item = unmarshall(getResp.Item) as any;

    const now = nowSec();
    if (item.disabled) return jsonResp(423, { ok: false, code: 'TOKEN_DISABLED', message: 'token disabled' });
    if (item.expires_at && Number(item.expires_at) > 0 && Number(item.expires_at) < now) return jsonResp(410, { ok: false, code: 'TOKEN_EXPIRED', message: 'token expired' });

    const leaseEnd = now + LEASE_SECONDS;
    const updateExpr: string[] = ['SET bound_device_id = :did, bound_at = :now, session_expires_at = :lease, updated_at = :now'];
    const exprValues: Record<string, any> = { ':did': device_id, ':now': now, ':lease': leaseEnd };
    
    // Save current_container_count if provided
    if (current_container_count !== null) {
      updateExpr.push('current_container_count = :ccc, container_count_updated_at = :ts');
      exprValues[':ccc'] = current_container_count;
      exprValues[':ts'] = now;
      item.current_container_count = current_container_count;
    }

    await ddb.send(new UpdateItemCommand({ TableName: TOKENS_TABLE, Key: marshall({ token_id: token }), UpdateExpression: updateExpr.join(', '), ExpressionAttributeValues: marshall(exprValues) }));

    try { const log = { event_id: `${token}#${now}#validate`, token, event_type: 'validate', actor: device_id, ts: now, detail: device_info || {}, ttl: now + LOG_TTL_SECONDS }; await ddb.send(new PutItemCommand({ TableName: TOKEN_EVENTS_TABLE, Item: marshall(log) })); } catch (e) { console.warn('putLog failed', String(e)); }

    const respItem = { token: item.token, remaining_quota: item.remaining_quota || 0, current_container_count: item.current_container_count || 0, expires_at: item.expires_at || null };
    return jsonResp(200, { ok: true, code: 'OK', data: { ...respItem, bound: true, session_expires_at: leaseEnd } });
  } catch (e: any) { console.error('validate error', e); return jsonResp(500, { ok: false, code: 'SERVER_ERROR', message: String(e?.message || e) }); }
};



// ci-trigger: 20251019T141705Z

// ci-trigger-2: 20251019T152400Z

// ci-trigger-final: 20251019T155720Z
