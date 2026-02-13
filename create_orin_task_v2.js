const https = require('https');
const fs = require('fs');

// Read the deploy key from .env.deploy
let deployKey = fs.readFileSync('.env.deploy', 'utf8').trim();
const match = deployKey.match(/CONVEX_DEPLOY_KEY=(.+)/);
if (!match) {
  throw new Error("CONVEX_DEPLOY_KEY not found in .env.deploy");
}
deployKey = match[1].trim();
const [prefix, token] = deployKey.split('|');

const CONVEX_URL = "https://exciting-warbler-274.eu-west-1.convex.cloud";

async function callMutation(functionName, args) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      functionName,
      args,
      token: token
    });

    const req = https.request(`${CONVEX_URL}/api/deployment/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Convex-Client': 'node-1.0',
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message || json.error));
          else resolve(json.value);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function callQuery(functionName, args) {
  return new Promise((resolve, reject) => {
    const queryString = Object.keys(args).length > 0 
      ? '?' + new URLSearchParams(args).toString() 
      : '';
    
    const payload = JSON.stringify(args);

    const req = https.request(`${CONVEX_URL}/api/queries/${functionName}${queryString}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Convex-Client': 'node-1.0',
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message || json.error));
          else resolve(json.value);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log("🔍 Connecting to Convex...\n");
  
  try {
    // Get all agents first
    console.log("📋 Fetching agents...");
    const agents = await callQuery("getAllAgents", {});
    console.log("Agents:", agents.map(a => `${a.name} (${a.role})`).join(", "));
    
    const orin = agents.find(a => a.name === "ORIN");
    if (!orin) {
      console.error("❌ ORIN agent not found");
      process.exit(1);
    }
    
    console.log(`\n✅ Found ORIN: ${orin._id}\n`);
    
    // Create validation task
    console.log("📋 Creating validation task for ORIN...");
    
    const taskId = await callMutation("createTask", {
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
      assignees: [orin._id.toString()],
      priority: "high",
      creatorId: "veda-agent"
    });
    
    console.log(`\n✅ Task created successfully!`);
    console.log(`Task ID: ${taskId}`);
    
    // Send message to task
    await callMutation("sendMessage", {
      taskId: taskId,
      authorId: "veda-agent",
      content: `🎯 **VEDA Analysis Complete!**

See VEDA_COMPETITOR_ANALYSIS.md for full details.

**Top Finding:** AI-Powered Insights Generator (ICE: 342) is the #1 opportunity.

**Competitor Analysis Summary:**
- Amplitude: AI Agents, AI Visibility, AI Feedback ✓
- Heap: Sense AI, Heap Illuminate ✓
- Contentsquare: Sense AI, Conversation Intelligence ✓
- **GAP:** No competitor has automated "insights inbox"

@ORIN Please validate customer pain points for this feature. Target: Decision within 72 hours.`,
      mentions: [orin._id.toString()]
    });
    
    console.log("📨 Message sent to ORIN's task queue\n");
    
    console.log("=".repeat(50));
    console.log("📌 VEDA STAGE 1 COMPLETE");
    console.log("=".repeat(50));
    console.log(`
Task: [REVENUE] AI-Powered Feature Gap Opportunity
Status: Competitor Analysis Complete

ICE Scores (Top 5 Opportunities):
1. AI-Powered Insights Generator: ICE 342 🔴
2. Auto-Generated Dashboards: ICE 336 🟠
3. Conversational Analytics: ICE 280 🟠
4. AI-Driven Segmentation: ICE 245 🟠
5. Predictive Churn Model: ICE 216 🟠

Next: ORIN validation → Cestra decision
Timeline: Decision within 72 hours
`);
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
