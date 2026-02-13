const https = require('https');
const fs = require('fs');

// Try the access token from ~/.convex/config.json
const accessToken = fs.readFileSync('/root/.openclaw/workspace-cestra/.convex-auth-token', 'utf8').trim().replace(/\s*EOF\s*$/, '').trim();

console.log('Access token length:', accessToken.length);

// Try accessing the API with the access token
const callApi = async (path, method = 'GET') => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'exciting-warbler-274.eu-west-1.convex.cloud',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    console.log('Making request to:', options.path);
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Response status:', res.statusCode);
        console.log('Response body:', body);
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', reject);
    req.end();
  });
};

callApi('/api').then(() => {
  console.log('---');
  return callApi('/api/queries/getAllAgents', 'POST');
}).catch(err => {
  console.error('Error:', err.message);
});
