#!/usr/bin/env node
// Preload AppConfig from DynamoDB and write to ./.tmp/app-config.json
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

async function main() {
  try {
    const TABLE = process.env.TBL_APP_CONFIG || 'AppConfig';
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-northeast-1';
    const client = new DynamoDBClient({ region });
    const out = await client.send(new ScanCommand({ TableName: TABLE }));
    const items = (out && out.Items) || [];
    const m = {};
    for (const it of items) {
      const k = it.Key && it.Key.S ? String(it.Key.S).toUpperCase() : null;
      const v = it.Value && it.Value.S ? String(it.Value.S) : '';
      if (k) m[k] = v;
    }
    const dir = path.join(process.cwd(), '.tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, 'app-config.json');
    fs.writeFileSync(outPath, JSON.stringify(m, null, 2), { encoding: 'utf8', mode: 0o600 });
    console.log('[preload-app-config] wrote', outPath);
  } catch (e) {
    console.error('[preload-app-config] failed to preload AppConfig:', e && e.message ? e.message : e);
    // Do not fail startup hard; caller may choose to ignore
    process.exitCode = 1;
  }
}

main();


