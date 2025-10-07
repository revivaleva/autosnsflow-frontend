/**
 * Read AppConfig table and generate .env file for build-time consumption
 * Usage: node scripts/generate-env-from-config.js > .env
 */
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const ddb = new DynamoDBClient({});
const TBL = process.env.TBL_APP_CONFIG || 'AppConfig';

async function main(){
  const out = await ddb.send(new ScanCommand({ TableName: TBL }));
  const items = (out && out.Items) || [];
  for (const it of items){
    const k = it.Key && it.Key.S && String(it.Key.S).toUpperCase();
    const v = it.Value && it.Value.S ? String(it.Value.S) : '';
    // debug removed
  }
}

main().catch(e=>{ console.error('failed', e); process.exit(1); });


