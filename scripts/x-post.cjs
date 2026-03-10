#!/usr/bin/env node
/**
 * x-post.cjs
 * Posts an approved social_posts row to X/Twitter via v2 API with OAuth 1.0a.
 * Usage: node x-post.cjs <post_id>
 * Exit 0 on success, exit 1 on failure.
 * Logs all actions to /root/.openclaw/workspace-cestra/logs/x-post.log (JSON lines)
 */

'use strict';

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const LOG_FILE = '/root/.openclaw/workspace-cestra/logs/x-post.log';

// --- Logging ---
function log(entry) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    process.stderr.write(`Log write failed: ${e.message}\n`);
  }
}

// --- Credential parsing ---
function parseCredFile(filePath) {
  const creds = {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      creds[key] = value;
    }
  } catch (e) {
    process.stderr.write(`Error reading credentials from ${filePath}: ${e.message}\n`);
    process.exit(1);
  }
  return creds;
}

// --- HTTP helpers ---
function httpsRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        ...headers,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Supabase helpers ---
function supabaseGet(baseUrl, key, table, query) {
  return httpsRequest('GET', `${baseUrl}/rest/v1/${table}?${query}&select=*`, {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
  }, null);
}

function supabasePatch(baseUrl, key, table, query, payload) {
  return httpsRequest('PATCH', `${baseUrl}/rest/v1/${table}?${query}`, {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=minimal',
  }, payload);
}

// --- OAuth 1.0a ---
function rfc3986Encode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function buildOAuthHeader(method, url, oauthParams, consumerSecret, tokenSecret) {
  const baseUrl = url.split('?')[0];

  // Collect all oauth params for signing (sorted)
  const allParams = { ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map(k => `${rfc3986Encode(k)}=${rfc3986Encode(allParams[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    rfc3986Encode(baseUrl),
    rfc3986Encode(paramString),
  ].join('&');

  const signingKey = `${rfc3986Encode(consumerSecret)}&${rfc3986Encode(tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  const headerParts = [...sortedKeys, 'oauth_signature'].sort().map(k => {
    const val = k === 'oauth_signature' ? signature : allParams[k];
    return `${rfc3986Encode(k)}="${rfc3986Encode(val)}"`;
  });

  return `OAuth ${headerParts.join(', ')}`;
}

// --- Post to X ---
async function postToX(content, xCreds) {
  const xUrl = 'https://api.x.com/2/tweets';

  const oauthParams = {
    oauth_consumer_key: xCreds.X_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: xCreds.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const authHeader = buildOAuthHeader(
    'POST',
    xUrl,
    oauthParams,
    xCreds.X_CONSUMER_SECRET,
    xCreds.X_ACCESS_TOKEN_SECRET
  );

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log({ action: 'post_attempt', attempt, result: 'pending', error: null, tweet_id: null });

    let res;
    try {
      res = await httpsRequest('POST', xUrl, {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      }, { text: content });
    } catch (e) {
      lastError = e.message;
      log({ action: 'post_attempt', attempt, result: 'error', error: e.message, tweet_id: null, http_status: null });
      if (attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt - 1) * 1000);
        continue;
      }
      break;
    }

    if (res.status === 201) {
      let data;
      try {
        data = JSON.parse(res.body);
      } catch (e) {
        lastError = `Failed to parse X response: ${res.body}`;
        log({ action: 'post_failed', attempt, result: 'error', error: lastError, tweet_id: null, http_status: res.status });
        break;
      }
      const tweetId = data?.data?.id;
      log({ action: 'post_success', attempt, result: 'ok', error: null, tweet_id: tweetId, http_status: 201 });
      return { success: true, tweetId };
    }

    if (res.status === 429) {
      // Rate limited — wait until reset
      const resetTs = parseInt(res.headers['x-rate-limit-reset'] || '0', 10);
      const waitMs = resetTs ? (resetTs * 1000 - Date.now() + 1000) : (Math.pow(2, attempt) * 1000);
      lastError = `Rate limited (429), waiting ${Math.ceil(waitMs / 1000)}s`;
      log({ action: 'retry', attempt, result: 'rate_limited', error: lastError, tweet_id: null, http_status: 429 });
      if (attempt < MAX_RETRIES) {
        await sleep(Math.max(waitMs, 1000));
        continue;
      }
    } else if (res.status === 503) {
      lastError = `Service unavailable (503)`;
      log({ action: 'retry', attempt, result: 'error', error: lastError, tweet_id: null, http_status: 503 });
      if (attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt - 1) * 1000);
        continue;
      }
    } else {
      // 4xx or other — don't retry
      lastError = `X API error HTTP ${res.status}: ${res.body}`;
      log({ action: 'post_failed', attempt, result: 'error', error: lastError, tweet_id: null, http_status: res.status });
      break;
    }
  }

  return { success: false, error: lastError };
}

// --- Main ---
async function main() {
  const postId = process.argv[2];
  if (!postId) {
    process.stderr.write('Error: post_id required as first argument\n');
    process.exit(1);
  }

  // Load credentials
  const xCreds = parseCredFile('/root/.x-credentials');
  const sbCreds = parseCredFile('/root/.dc81-supabase-credentials');

  const supabaseUrl = sbCreds['DC81_SUPABASE_URL'];
  const supabaseKey = sbCreds['DC81_SUPABASE_ANON_KEY'];

  const requiredX = ['X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
  for (const k of requiredX) {
    if (!xCreds[k]) {
      const err = `Missing X credential: ${k}`;
      log({ action: 'validation_error', post_id: postId, result: 'error', error: err });
      process.stderr.write(`Error: ${err}\n`);
      process.exit(1);
    }
  }

  if (!supabaseUrl || !supabaseKey) {
    const err = 'Missing DC81_SUPABASE_URL or DC81_SUPABASE_ANON_KEY';
    log({ action: 'validation_error', post_id: postId, result: 'error', error: err });
    process.stderr.write(`Error: ${err}\n`);
    process.exit(1);
  }

  // Fetch post from Supabase
  log({ action: 'fetch_post', post_id: postId, result: 'pending', error: null });
  let fetchRes;
  try {
    fetchRes = await supabaseGet(supabaseUrl, supabaseKey, 'social_posts', `id=eq.${postId}`);
  } catch (e) {
    const err = `Supabase fetch failed: ${e.message}`;
    log({ action: 'fetch_post', post_id: postId, result: 'error', error: err });
    process.stderr.write(`Error: ${err}\n`);
    process.exit(1);
  }

  let rows;
  try {
    rows = JSON.parse(fetchRes.body);
  } catch (e) {
    const err = `Failed to parse Supabase response: ${fetchRes.body}`;
    log({ action: 'fetch_post', post_id: postId, result: 'error', error: err });
    process.stderr.write(`Error: ${err}\n`);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    const err = `Post not found: ${postId}`;
    log({ action: 'validation_error', post_id: postId, result: 'error', error: err });
    process.stderr.write(`Error: ${err}\n`);
    process.exit(1);
  }

  const post = rows[0];

  if (post.status !== 'approved') {
    const err = `Post not in approved status (actual: ${post.status})`;
    log({ action: 'validation_error', post_id: postId, result: 'error', error: err });
    process.stderr.write(`Error: ${err}\n`);
    process.exit(1);
  }

  if (post.platform !== 'x') {
    const err = `Wrong platform: ${post.platform}`;
    log({ action: 'validation_error', post_id: postId, result: 'error', error: err });
    process.stderr.write(`Error: ${err}\n`);
    process.exit(1);
  }

  // Post to X
  const xResult = await postToX(post.content, xCreds);
  const now = new Date().toISOString();

  if (xResult.success) {
    // Update Supabase: posted
    try {
      await supabasePatch(supabaseUrl, supabaseKey, 'social_posts', `id=eq.${postId}`, {
        status: 'posted',
        platform_post_id: xResult.tweetId,
        posted_at: now,
        updated_at: now,
      });
      log({ action: 'supabase_update', post_id: postId, result: 'ok', tweet_id: xResult.tweetId, error: null });
    } catch (e) {
      log({ action: 'supabase_update', post_id: postId, result: 'error', error: e.message, tweet_id: xResult.tweetId });
    }
    process.stdout.write(`Posted. Tweet ID: ${xResult.tweetId}\n`);
    process.exit(0);
  } else {
    // Update Supabase: failed
    try {
      await supabasePatch(supabaseUrl, supabaseKey, 'social_posts', `id=eq.${postId}`, {
        status: 'failed',
        updated_at: now,
      });
      log({ action: 'supabase_update', post_id: postId, result: 'ok', tweet_id: null, error: null, note: 'marked failed' });
    } catch (e) {
      log({ action: 'supabase_update', post_id: postId, result: 'error', error: e.message });
    }
    process.stderr.write(`Error: Post failed — ${xResult.error}\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  log({ action: 'unhandled_error', result: 'error', error: e.message });
  process.stderr.write(`Unhandled error: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
