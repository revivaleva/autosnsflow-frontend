#!/usr/bin/env node
// Test script: fetch public profile posts via Threads Profile Discovery API
// Usage: node scripts/test-profile-posts.js <username> [access_token]
import fetch from 'node-fetch';

const username = process.argv[2];
const accessToken = process.argv[3] || process.env.THREADS_APP_TOKEN || '';
if (!username) {
  console.error('Usage: node scripts/test-profile-posts.js <username> [access_token]');
  process.exit(2);
}

const BASE = process.env.THREADS_GRAPH_BASE || 'https://graph.threads.net/v1.0';

async function main() {
  try {
    if (!accessToken) {
      console.error('No access token provided. Set via arg or THREADS_APP_TOKEN env var.');
      process.exit(2);
    }

    const fields = ['id','shortcode','timestamp','text','username'];
    const url = `${BASE}/profile_posts?username=${encodeURIComponent(username)}&fields=${encodeURIComponent(fields.join(','))}&access_token=${encodeURIComponent(accessToken)}&limit=5`;
    console.log('Request URL:', url.replace(/access_token=[^&]+/, 'access_token=REDACTED'));
    const res = await fetch(url);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    console.log('status=', res.status, 'ok=', res.ok);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error', String(e));
    process.exit(1);
  }
}

main();



