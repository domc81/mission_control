import https from 'https';
import crypto from 'crypto';
import fs from 'fs';

function parseCredFile(path) {
  const content = fs.readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const creds = {};
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      creds[key.trim()] = valueParts.join('=').trim();
    }
  }
  return creds;
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function generateOAuthSignature(params, method, baseUrl, consumerSecret, tokenSecret) {
  const paramPairs = [];
  for (const [k, v] of Object.entries(params)) {
    paramPairs.push([percentEncode(k), percentEncode(v)]);
  }
  paramPairs.sort((a, b) => a[0].localeCompare(b[0]));
  const paramStr = paramPairs.map(([k, v]) => `${k}=${v}`).join('&');
  const baseStr = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramStr)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const hmac = crypto.createHmac('sha1', signingKey);
  hmac.update(baseStr);
  return hmac.digest('base64');
}

function makeHttpsRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

function logEntry(entry) {
  const line = JSON.stringify({...entry, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync('/root/.openclaw/workspace-cestra/logs/x-post.log', line);
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error('Error: post_id required as first argument');
    process.exit(1);
  }

  try {
    // Load Supabase creds
    const supabaseCreds = parseCredFile('/root/.dc81-supabase-credentials');
    const supabaseUrl = supabaseCreds.DC81_SUPABASE_URL.replace(/\/$/, '');
    const supabaseKey = supabaseCreds.DC81_SUPABASE_ANON_KEY;

    // Load X creds
    const xCreds = parseCredFile('/root/.x-credentials');
    const consumerKey = xCreds.X_CONSUMER_KEY;
    const consumerSecret = xCreds.X_CONSUMER_SECRET;
    const accessToken = xCreds.X_ACCESS_TOKEN;
    const accessTokenSecret = xCreds.X_ACCESS_TOKEN_SECRET;

    // Fetch post from Supabase
    const fetchOptions = {
      hostname: new URL(`${supabaseUrl}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}&select=*`).hostname,
      path: new URL(`${supabaseUrl}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}&select=*`).pathname,
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    };

    const res = await makeHttpsRequest(fetchOptions);
    if (res.status !== 200 || !Array.isArray(res.body) || res.body.length === 0) {
      logEntry({ action: 'validation_error', post_id: postId, result: 'error', error: 'post not found' });
      process.exit(1);
    }
    const row = res.body[0];
    if (row.status !== 'approved') {
      logEntry({ action: 'validation_error', post_id: postId, result: 'error', error: `post not in approved status (actual: ${row.status})` });
      process.exit(1);
    }
    if (row.platform !== 'x') {
      logEntry({ action: 'validation_error', post_id: postId, result: 'error', error: `wrong platform: ${row.platform}` });
      process.exit(1);
    }

    // Post to X with retries
    const postUrl = 'https://api.x.com/2/tweets';
    let tweetId = null;
    let lastError = null;
    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
      logEntry({ action: 'post_attempt', post_id: postId, result: 'ok', attempt });

      // OAuth params
      const oauthParams = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: accessToken,
        oauth_version: '1.0',
      };

      const signature = generateOAuthSignature(oauthParams, 'POST', postUrl, consumerSecret, accessTokenSecret);
      oauthParams.oauth_signature = signature;

      const authHeader = 'OAuth ' + Object.entries(oauthParams).map(([k, v]) => `${k}="${percentEncode(v)}"`).join(', ');

      const postOptions = {
        hostname: 'api.x.com',
        path: '/2/tweets',
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
      };

      const postBody = { text: row.content };

      let postRes;
      try {
        postRes = await makeHttpsRequest(postOptions, postBody);
      } catch (err) {
        lastError = err.message;
        attempt++;
        if (attempt < maxRetries) {
          const backoffMs = 2 ** attempt * 1000;
          await new Promise(r => setTimeout(r, backoffMs));
          logEntry({ action: 'retry', post_id: postId, result: 'ok', attempt, error: lastError });
          continue;
        } else {
          break;
        }
      }

      if (postRes.status === 429) {
        const resetTime = parseInt(postRes.headers['x-rate-limit-reset']) * 1000;
        const waitMs = resetTime - Date.now() + 1000;
        await new Promise(r => setTimeout(r, waitMs));
        attempt++;
        logEntry({ action: 'retry', post_id: postId, result: 'ok', attempt, error: '429 rate limit' });
        continue;
      }

      if (postRes.status === 201 && postRes.body && postRes.body.data && postRes.body.data.id) {
        tweetId = postRes.body.data.id;
        logEntry({ action: 'post_success', post_id: postId, result: 'ok', tweet_id: tweetId, attempt });
        break;
      } else if (postRes.status >= 400 && postRes.status !== 429 && postRes.status !== 503) {
        lastError = `HTTP ${postRes.status}: ${JSON.stringify(postRes.body)}`;
        attempt = maxRetries; // no retry for 4xx
        break;
      } else if (postRes.status === 503 || postRes.status < 200 || postRes.status >= 500) {
        lastError = `HTTP ${postRes.status}`;
        attempt++;
        if (attempt < maxRetries) {
          const backoffMs = 2 ** attempt * 1000;
          await new Promise(r => setTimeout(r, waitMs));
          logEntry({ action: 'retry', post_id: postId, result: 'ok', attempt, error: lastError });
          continue;
        } else {
          break;
        }
      } else {
        lastError = `Unexpected status ${postRes.status}`;
        attempt++;
        if (attempt < maxRetries) {
          const backoffMs = 2 ** attempt * 1000;
          await new Promise(r => setTimeout(r, backoffMs));
          logEntry({ action: 'retry', post_id: postId, result: 'ok', attempt, error: lastError });
          continue;
        } else {
          break;
        }
      }
    }

    const now = new Date().toISOString();

    // Update Supabase
    let patchBody;
    if (tweetId) {
      patchBody = {
        status: 'posted',
        platform_post_id: tweetId,
        posted_at: now,
        updated_at: now,
      };
      logEntry({ action: 'supabase_update', post_id: postId, result: 'ok', tweet_id: tweetId });
    } else {
      patchBody = {
        status: 'failed',
        updated_at: now,
      };
      logEntry({ action: 'post_failed', post_id: postId, result: 'error', error: lastError });
    }

    const patchOptions = {
      hostname: new URL(`${supabaseUrl}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}`).hostname,
      path: new URL(`${supabaseUrl}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}`).pathname,
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
    };

    try {
      const patchRes = await makeHttpsRequest(patchOptions, patchBody);
      if (patchRes.status < 200 || patchRes.status >= 300) {
        logEntry({ action: 'supabase_update', post_id: postId, result: 'error', error: `PATCH failed: ${JSON.stringify(patchRes.body)}` });
      }
    } catch (err) {
      logEntry({ action: 'supabase_update', post_id: postId, result: 'error', error: err.message });
    }

    process.exit(tweetId ? 0 : 1);
  } catch (err) {
    logEntry({ action: 'validation_error', post_id: postId, result: 'error', error: err.message });
    process.exit(1);
  }
}

main();