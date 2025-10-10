const fs = require('fs');
const path = require('path');

function checkFile(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const hasOauth = txt.includes('oauthAccessToken');
  const hasTokenToUse = txt.includes('tokenToUse') || txt.includes('acct.oauthAccessToken || acct.accessToken');
  return { hasOauth, hasTokenToUse };
}

const target = path.join(__dirname, '..', 'src', 'pages', 'api', 'fetch-replies.ts');
if (!fs.existsSync(target)) {
  console.error('target file not found:', target);
  process.exit(2);
}

const res = checkFile(target);
console.log('fetch-replies token path check:', res);
if (!res.hasOauth || !res.hasTokenToUse) {
  console.error('token path check failed: oauthAccessToken usage missing or tokenToUse fallback missing');
  process.exit(1);
}
console.log('OK');
process.exit(0);


