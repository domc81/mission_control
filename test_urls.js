const https = require('https');
const fs = require('fs');

// Try the access token from ~/.convex/config.json
const accessToken = fs.readFileSync('/root/.openclaw/workspace-cestra/.convex-auth-token', 'utf8').trim().replace(/\s*EOF\s*$/, '').trim();

// Different URL variations
const urlVariants = [
  'exciting-warbler-274.convex.cloud',
  'exciting-warbler-274.eu-west-1.convex.cloud',
  'dc81-exciting-warbler-274.convex.cloud',
  'dc81-exciting-warbler-274.eu-west-1.convex.cloud'
];

const testUrl = async (hostname) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: hostname,
      path: '/api',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ hostname, status: res.statusCode, body: body.slice(0, 100) });
      });
    });

    req.on('error', (err) => {
      resolve({ hostname, error: err.message });
    });
    
    // Set a timeout
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ hostname, error: 'timeout' });
    });
    
    req.end();
  });
};

async function runTests() {
  for (const variant of urlVariants) {
    const result = await testUrl(variant);
    console.log(`${result.hostname}: ${result.error || result.status}`);
  }
}

runTests();
