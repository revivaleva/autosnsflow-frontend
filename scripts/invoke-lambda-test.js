#!/usr/bin/env node
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

async function main() {
  const fn = process.argv[2] || process.env.LAMBDA_FN || 'scheduled-autosnsflow';
  const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'ap-northeast-1';
  const client = new LambdaClient({ region });
  const payload = JSON.stringify({ job: 'every-5min' });
  try {
    const cmd = new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(payload), LogType: 'Tail' });
    const res = await client.send(cmd);
    if (res.LogResult) {
      const logs = Buffer.from(res.LogResult, 'base64').toString('utf8');
      console.log('=== LOGS ===');
      console.log(logs);
    }
    if (res.Payload) {
      const out = Buffer.from(res.Payload).toString('utf8');
      console.log('=== RESPONSE PAYLOAD ===');
      console.log(out);
    }
  } catch (e) {
    console.error('invoke failed', e);
    process.exit(2);
  }
}

main();


