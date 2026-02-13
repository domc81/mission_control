const https = require('https');
const fs = require('fs');

// Read the deploy key and clean it up
let deployKey = fs.readFileSync('.convex-deploy-key', 'utf8').trim();
// Remove any trailing whitespace and "EOF" if present
deployKey = deployKey.replace(/\s*EOF\s*$/, '').trim();
const [prefix, token] = deployKey.split('|');

console.log('Deploy key prefix:', prefix);
console.log('Token length:', token ? token.length : 0);

const callMutation = async (functionName, args) => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      args: args
    });

    const options = {
      hostname: 'exciting-warbler-274.eu-west-1.convex.cloud',
      path: `/api/mutations/${functionName}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    console.log('Making request to:', options.path);
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Response status:', res.statusCode);
        console.log('Response body:', body);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
};

// Try to call the registerAgent function
callMutation('registerAgent', {
  name: 'VEDA',
  role: 'Product Intelligence Analyst',
  capabilities: ['product_analysis', 'competitor_intelligence', 'feature_scoring'],
  workspace: '/root/.openclaw/workspace-veda',
  heartbeatOffset: 2
}).then(result => {
  console.log('Success:', result);
}).catch(err => {
  console.error('Error:', err.message);
});
