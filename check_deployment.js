const https = require('https');
const fs = require('fs');
const deployKey = fs.readFileSync('.convex-deploy-key', 'utf8').trim().split('|')[1];
const accessToken = fs.readFileSync('/root/.openclaw/workspace-cestra/.convex-auth-token', 'utf8').trim();

const testEndpoints = async () => {
  const token = accessToken;
  const endpoints = ['/api', '/api/queries/getAllAgents', '/api/mutations/registerAgent'];
  
  for (const path of endpoints) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'exciting-warbler-274.eu-west-1.convex.cloud',
          path: path,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => resolve({ path, status: res.statusCode }));
        });
        req.on('error', reject);
        req.end();
      });
      console.log(`${result.path}: ${result.status}`);
    } catch (e) {
      console.log(`${path}: error - ${e.message}`);
    }
  }
};
testEndpoints();
