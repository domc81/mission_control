const https = require('https');
const fs = require('fs');
const { URL } = require('url');

// Read the deploy key from .env.deploy
let deployKey = fs.readFileSync('.env.deploy', 'utf8').trim();
const match = deployKey.match(/CONVEX_DEPLOY_KEY=(.+)/);
if (!match) {
  throw new Error("CONVEX_DEPLOY_KEY not found in .env.deploy");
}
deployKey = match[1].trim();
const [prefix, token] = deployKey.split('|');

const CONVEX_URL = "https://exciting-warbler-274.eu-west-1.convex.cloud";

async function makeRequest(path, method, args = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(args);
    
    const url = new URL(path, CONVEX_URL);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Convex-Client': 'node-1.0',
        'Authorization': `Bearer ${token}`
      }
    };

    console.log(`  Making ${method} request to: ${options.path}`);
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  Response status: ${res.statusCode}`);
        console.log(`  Response length: ${data.length} chars`);
        
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        
        if (!data.trim()) {
          resolve(null);
          return;
        }
        
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message || json.error));
          else resolve(json.value);
        } catch (e) {
          console.error("  Failed to parse JSON:", data.slice(0, 200));
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function main() {
  console.log("🔍 Connecting to Convex...\n");
  
  try {
    // Get all agents first
    console.log("📋 Fetching agents...");
    const agents = await makeRequest('/api/queries/getAllAgents', 'POST', {});
    console.log("Agents found:", agents ? agents.length : 0);
    
    if (agents && agents.length > 0) {
      console.log("Agents:", agents.map(a => `${a.name} (${a.role})`).join(", "));
    }
    
    // Try to find ORIN by name from the list or by querying a different way
    const orin = agents ? agents.find(a => a.name === "ORIN") : null;
    
    if (!orin) {
      // Try to query by status or get a different view
      console.log("\n⚠️ ORIN not found in agents list, checking active tasks...");
      const tasks = await makeRequest('/api/queries/getActiveTasks', 'POST', {});
      console.log("Active tasks:", tasks ? tasks.length : 0);
      
      // For now, use a placeholder ORIN ID based on memory
      const orinId = "j97dfmkd4f97h02cv04681ygk180rfp0"; // From MEMORY.md
      console.log(`\n✅ Using ORIN ID from memory: ${orinId}`);
      
      // Create task
      console.log("\n📋 Creating validation task for ORIN...");
      
      const taskId = await makeRequest('/api/deployment/mutation', 'POST', {
        functionName: "createTask",
        args: {
          title: "[REVENUE] AI Insights Generator - Customer Validation",
          description: `VEDA completed competitor analysis. ORIN needs to validate:

1. **Customer Pain:** Do users feel overwhelmed by data but lack actionable insights?
2. **Willingness to Pay:** Is this a premium feature or core offering?
3. **Competitor Gap:** Confirm no competitor has "set it and forget it" insights
4. **Technical Feasibility:** Are LLMs ready for accurate analytics summarization?

See: VEDA_COMPETITOR_ANALYSIS.md for full analysis

**Top Recommendation:** AI-Powered Insights Generator (ICE: 342)
- Automatically analyzes product usage data
- Generates actionable insights in plain language
- Competitive gap: No competitor has fully automated "insights inbox"

Deliverable: Validation report with go/no-go recommendation`,
          assignees: [orinId],
          priority: "high",
          creatorId: "veda-agent"
        },
        token: token
      });
      
      console.log(`\n✅ Task creation initiated!`);
      
    } else {
      console.log(`\n✅ Found ORIN: ${orin._id}`);
    }
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

main();
