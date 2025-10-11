import { createDynamoClient } from './ddb';
import { GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';

const ddb = createDynamoClient();
const TBL = process.env.TBL_APP_CONFIG || 'AppConfig';

let cached: Record<string,string> | null = null;

export async function loadConfig(): Promise<Record<string,string>> {
  if (cached) return cached;
  // Prefer a preloaded file (written at startup) for deterministic startup behavior
  try {
    const pre = require('path').join(process.cwd(), '.tmp', 'app-config.json');
    const fs = require('fs');
    if (fs.existsSync(pre)) {
      const txt = fs.readFileSync(pre, 'utf8');
      const parsed = JSON.parse(txt || '{}');
      cached = Object.keys(parsed || {}).reduce((acc, k) => { acc[k.toUpperCase()] = String(parsed[k] ?? ''); return acc; }, {} as Record<string,string>);
      return cached;
    }
  } catch (e) {
    // ignore and fallback to DB
  }

  // load from DynamoDB - fail fast on error
  const out = await ddb.send(new ScanCommand({ TableName: TBL }));
  if (!out || !out.Items) throw new Error('failed_load_appconfig');
  const items: any[] = (out as any).Items || [];
  const m: Record<string,string> = {};
  for (const it of items) {
    const k = it.Key?.S;
    // Use only Value.S as canonical source to match AppConfig table schema
    const v = it.Value?.S || '';
    if (k) m[k.toUpperCase()] = String(v ?? '');
  }
  cached = m;
  return m;
}

export function getConfigValue(key: string, fallback?: string) {
  // Enforce AppConfig to be loaded. Fail-fast if not loaded to prevent silent
  // divergence between DB config and local env during development/testing.
  if (!cached) throw new Error('AppConfig not loaded. Call loadConfig() at startup.');
  const upper = key.toUpperCase();
  return (cached[upper] ?? fallback);
}

export default { loadConfig, getConfigValue };


