#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

(async function main(){
  try{
    const table = process.env.TBL_SETTINGS || 'UserSettings';
    const region = process.env.AWS_REGION || 'ap-northeast-1';
    const ddb = new DynamoDBClient({ region });

    let items = [];
    let lastKey;
    do {
      const cmd = new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey, Limit: 200 });
      const res = await ddb.send(cmd);
      items = items.concat(res.Items || []);
      lastKey = res.LastEvaluatedKey;
    } while(lastKey);

    const backupFile = path.resolve(process.cwd(), `migration-backup-UserSettings-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(items, null, 2));
    console.log('Wrote backup to', backupFile);

    let updated = 0;
    for (const it of items) {
      const pk = it.PK?.S || it.PK?.N || null;
      const sk = it.SK?.S || it.SK?.N || null;
      if (!pk || !sk) continue;
      // If maxThreadsAccounts exists, skip
      if (it.maxThreadsAccounts) continue;
      const params = {
        TableName: table,
        Key: { PK: { S: pk }, SK: { S: sk } },
        UpdateExpression: 'SET maxThreadsAccounts = :m',
        ExpressionAttributeValues: { ':m': { N: '0' } }
      };
      try {
        await ddb.send(new UpdateItemCommand(params));
        updated++;
      } catch (e) {
        console.error('failed update for', pk, sk, e);
      }
    }

    console.log('Migration completed. updated=', updated);
  }catch(e){
    console.error('Migration failed:', e);
    process.exit(1);
  }
})();


