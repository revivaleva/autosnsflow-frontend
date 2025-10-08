/*
Simple migration script: reads selected env vars from process.env and writes to DynamoDB AppConfig table
Usage: node scripts/migrate-env-to-config.js
*/
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const cfg = new DynamoDBClient({});
const TBL = process.env.TBL_APP_CONFIG || 'AppConfig';

const keys = [
  'MASTER_DISCORD_WEBHOOK',
  'TBL_DELETION_QUEUE',
  'THREADS_OAUTH_REDIRECT_PROD',
  'DELETION_BATCH_SIZE',
  'DELETION_RETRY_MAX',
  'DELETION_PROCESSING_INTERVAL_HOURS',
  'DELETION_NOTIFY_ON_ERROR'
];

(async ()=>{
  for (const k of keys) {
    const v = process.env[k] || '';
    // debug removed
    const cmd = new PutItemCommand({ TableName: TBL, Item: { Key: { S: k }, Value: { S: String(v) } } });
    try { await cfg.send(cmd); } catch (e) { console.error('failed', e); }
  }
  // debug removed
})();


