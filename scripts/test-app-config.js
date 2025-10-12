#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

(async function main(){
  try{
    const pre = path.join(process.cwd(), '.tmp', 'app-config.json');
    if (fs.existsSync(pre)){
      const txt = fs.readFileSync(pre,'utf8');
      const parsed = JSON.parse(txt||'{}');
      console.log('[app-config] loaded from .tmp/app-config.json');
      console.log(JSON.stringify(parsed, null, 2));
      process.exit(0);
    }

    // Fallback: try to read from DynamoDB AppConfig table
    console.log('[app-config] .tmp/app-config.json not found, attempting to read from DynamoDB');
    const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
    const region = process.env.NEXT_PUBLIC_AWS_REGION || process.env.AWS_REGION || 'ap-northeast-1';
    const client = new DynamoDBClient({ region });
    const table = process.env.TBL_APP_CONFIG || 'AppConfig';
    const out = await client.send(new ScanCommand({ TableName: table, Limit: 200 }));
    const items = (out.Items||[]).reduce((acc,it)=>{ const k = it.Key?.S; const v = it.Value?.S; if(k) acc[k.toUpperCase()] = v||''; return acc }, {});
    console.log('[app-config] loaded from DynamoDB table:', table);
    console.log(JSON.stringify(items, null, 2));
    process.exit(0);
  }catch(e){
    console.error('[error] failed to load AppConfig:', String(e));
    process.exit(2);
  }
})();


