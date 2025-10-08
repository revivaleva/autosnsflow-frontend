#!/usr/bin/env node
// Temporary dev helper: query AppConfig table via AWS SDK and print KEY=VALUE
require('dotenv').config({ path: '.env.local' });
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

async function main() {
  try {
    const TABLE = process.env.TBL_APP_CONFIG || 'AppConfig';
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const client = new DynamoDBClient({ region });
    const out = await client.send(new ScanCommand({ TableName: TABLE }));
    const items = (out && out.Items) || [];
    if (!items.length) {
      console.log('[print-app-config] no items found in AppConfig');
      return;
    }
    console.log('[print-app-config] loaded AppConfig:');
    for (const it of items) {
      const k = it.Key && it.Key.S ? it.Key.S : undefined;
      const v = it.Value && it.Value.S ? it.Value.S : '';
      if (k) console.log(`${String(k).toUpperCase()}=${v}`);
    }
  } catch (e) {
    console.error('[print-app-config] failed to load AppConfig:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();


