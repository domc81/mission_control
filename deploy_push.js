const https = require('https');
const fs = require('fs');
const path = require('path');

// Read the deploy key and clean it up
let deployKey = fs.readFileSync('.convex-deploy-key', 'utf8').trim();
deployKey = deployKey.replace(/\s*EOF\s*$/, '').trim();
const [prefix, token] = deployKey.split('|');

console.log('Deploy key prefix:', prefix);
console.log('Token length:', token ? token.length : 0);

// The deployment URL
const deploymentUrl = 'https://exciting-warbler-274.eu-west-1.convex.cloud';

// To deploy, we need to push the convex functions
// The convex CLI typically handles this, but let's try the API

// First, let's check what endpoints are available
const checkEndpoints = async () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'exciting-warbler-274.eu-west-1.convex.cloud',
      path: '/api',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Response status:', res.statusCode);
        console.log('Response body:', body);
        resolve();
      });
    });

    req.on('error', reject);
    req.end();
  });
};

checkEndpoints().catch(err => {
  console.error('Error:', err.message);
});
