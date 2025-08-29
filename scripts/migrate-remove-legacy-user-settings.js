#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

(async function main(){
  try{
    const table = process.env.TBL_SETTINGS || 'UserSettings';
    const region = process.env.AWS_REGION || 'ap-northeast-1';
    const ddb = new DynamoDBClient({ region });

    console.log('Scanning table', table);
    let items = [];
    let lastKey;
    do {
      const cmd = new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey, Limit: 100 });
      const res = await ddb.send(cmd);
      items = items.concat(res.Items || []);
      lastKey = res.LastEvaluatedKey;
    } while(lastKey);

    // Filter items that contain legacy attributes (check both spellings)
    const legacyItems = items.filter(i => i.openAiApiKey || i.openaiApiKey || i.modelDefault);

    console.log(`Found ${legacyItems.length} items with legacy attributes`);
    const backupFile = path.resolve(process.cwd(), `migration-backup-UserSettings-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(legacyItems, null, 2));
    console.log('Wrote backup to', backupFile);

    for (const it of legacyItems) {
      const pk = it.PK.S; const sk = it.SK.S;
      // collect unique attribute names to remove
      const removesSet = new Set();
      if (it.openAiApiKey) removesSet.add('openAiApiKey');
      if (it.openaiApiKey) removesSet.add('openaiApiKey');
      if (it.modelDefault) removesSet.add('modelDefault');
      const removes = Array.from(removesSet);
      if (removes.length === 0) continue;

      const updateParams = {
        TableName: table,
        Key: { PK: { S: pk }, SK: { S: sk } },
        UpdateExpression: 'REMOVE ' + removes.map((k,i)=>`#r${i}`).join(', '),
        ExpressionAttributeNames: removes.reduce((acc,k,i)=>{ acc[`#r${i}`] = k; return acc; }, {}),
      };
      try{
        await ddb.send(new UpdateItemCommand(updateParams));
        console.log('Removed', removes.join(','), 'from', pk, sk);
      }catch(e){
        console.error('Failed to remove for', pk, sk, e);
      }
    }

    console.log('Migration done');
  }catch(e){
    console.error('Migration failed:', e);
    process.exit(1);
  }
})();
