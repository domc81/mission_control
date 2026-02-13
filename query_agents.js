const https = require('https');
const fs = require('fs');

// Read the deploy key and clean it up
let deployKey = fs.readFileSync('.convex-deploy-key', 'utf8').trim();
deployKey = deployKey.replace(/\s*EOF\s*$/, '').trim();
const [prefix, token] = deployKey.split('|');

const callQuery = async (functionName, args = {}) => {
  return new Promise((resolve, reject) => {
    // For queries, args go in query string
    const queryString = Object.keys(args).length > 0 
      ? '?' + new URLSearchParams(args).toString() 
      : '';
    
    const data = JSON.stringify(args);

    const options = {
      hostname: 'exciting-warbler-274.eu-west-1.convex.cloud',
      path: `/api/queries/${functionName}${queryString}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    console.log('Making query request to:', options.path);
    
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

// Try to get all agents
callQuery('getAllAgents', {})
  .then(result => {
    console.log('Success:', JSON.stringify(result, null, 2));
  })
  .catch(err => {
    console.error('Error:', err.message);
  });
