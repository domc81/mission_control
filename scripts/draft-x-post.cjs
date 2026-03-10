#!/usr/bin/env node
/**
 * draft-x-post.js
 * Creates a pending_approval X/Twitter post draft in Supabase social_posts.
 * Usage: node draft-x-post.js "<post text>"
 * Output: UUID of created row (stdout), exit 0 on success, exit 1 on failure
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

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

// --- HTTP POST helper ---
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// --- Main ---
async function main() {
  const text = process.argv[2];
  if (!text) {
    process.stderr.write('Error: post text required as first argument\n');
    process.exit(1);
  }

  // Character count (Unicode code points)
  const charCount = [...text].length;
  if (charCount > 280) {
    process.stderr.write(`Error: text is ${charCount} chars, max 280\n`);
    process.exit(1);
  }

  // Load credentials
  const sb = parseCredFile('/root/.dc81-supabase-credentials');
  const supabaseUrl = sb['DC81_SUPABASE_URL'];
  const supabaseKey = sb['DC81_SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    process.stderr.write('Error: Missing DC81_SUPABASE_URL or DC81_SUPABASE_ANON_KEY\n');
    process.exit(1);
  }

  // Parse hostname and base path from URL
  const urlObj = new URL(supabaseUrl);
  const hostname = urlObj.hostname;
  const basePath = urlObj.pathname.replace(/\/$/, '');

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Prefer': 'return=representation',
  };

  const payload = {
    platform: 'x',
    content: text,
    media_urls: [],
    status: 'pending_approval',
    scheduled_for: null,
  };

  let result;
  try {
    result = await httpsPost(hostname, `${basePath}/rest/v1/social_posts`, headers, payload);
  } catch (e) {
    process.stderr.write(`Error: HTTP request failed: ${e.message}\n`);
    process.exit(1);
  }

  if (result.status !== 201) {
    process.stderr.write(`Error: Supabase returned HTTP ${result.status}: ${result.body}\n`);
    process.exit(1);
  }

  let rows;
  try {
    rows = JSON.parse(result.body);
  } catch (e) {
    process.stderr.write(`Error: Failed to parse Supabase response: ${result.body}\n`);
    process.exit(1);
  }

  if (!rows || !rows[0] || !rows[0].id) {
    process.stderr.write(`Error: No ID in Supabase response: ${result.body}\n`);
    process.exit(1);
  }

  process.stdout.write(rows[0].id + '\n');
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`Unhandled error: ${e.message}\n`);
  process.exit(1);
});
