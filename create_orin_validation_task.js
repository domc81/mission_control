const https = require('https');
const fs = require("fs");

const CONVEX_URL = "https://exciting-warbler-274.eu-west-1.convex.cloud";
const AUTH_TOKEN = fs.readFileSync("/root/.openclaw/workspace-cestra/.convex-auth-token", "utf8").replace(/\s+/g, "").trim();

async function callConvex(functionName, args) {
  const payload = JSON.stringify({
    functionName,
    args,
    token: AUTH_TOKEN
  });

  return new Promise((resolve, reject) => {
    const req = https.request(`${CONVEX_URL}/api/deployment/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Convex-Client': 'node-1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error));
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

async function queryConvex(functionName, args) {
  const payload = JSON.stringify({
    functionName,
    args,
    token: AUTH_TOKEN
  });

  return new Promise((resolve, reject) => {
    const req = https.request(`${CONVEX_URL}/api/deployment/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Convex-Client': 'node-1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error));
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
  console.log("🔍 Looking up ORIN agent ID...\n");
  
  try {
    // Get all agents
    const agents = await queryConvex("getAllAgents", {});
    const orin = agents.find(a => a.name === "ORIN");
    
    if (!orin) {
      console.error("❌ ORIN agent not found");
      process.exit(1);
    }
    
    console.log(`✅ Found ORIN: ${orin._id}`);
    
    // Create validation task for ORIN
    console.log("\n📋 Creating validation task for ORIN...\n");
    
    const taskResult = await callConvex("createTask", {
      title: "[REVENUE] AI Insights Generator - Customer Validation",
      description: `VEDA completed competitor analysis. ORIN needs to validate:\n\n1. **Customer Pain:** Do users feel overwhelmed by data but lack actionable insights?\n2. **Willingness to Pay:** Is this a premium feature or core offering?\n3. **Competitor Gap:** Confirm no competitor has "set it and forget it" insights\n4. **Technical Feasibility:** Are LLMs ready for accurate analytics summarization?\n\nSee: VEDA_COMPETITOR_ANALYSIS.md for full analysis\n\n**Top Recommendation:** AI-Powered Insights Generator (ICE: 342)\n- Automatically analyzes product usage data\n- Generates actionable insights in plain language\n- Competitive gap: No competitor has fully automated "insights inbox"\n\nDeliverable: Validation report with go/no-go recommendation`,
      assignees: [orin._id.toString()],
      priority: "high",
      creatorId: "veda-agent"
    });
    
    console.log("✅ Task created successfully!");
    console.log(`Task ID: ${taskResult}`);
    console.log(`\n📌 ORIN Task Summary:\n- Title: AI Insights Generator - Customer Validation\n- Priority: HIGH\n- Status: Pending ORIN pickup\n- Parent: [REVENUE] AI-Powered Feature Gap Opportunity`);
    
    // Log activity
    await callConvex("sendMessage", {
      taskId: taskResult,
      authorId: "veda-agent",
      content: `🎯 VEDA analysis complete! See VEDA_COMPETITOR_ANALYSIS.md for details.\n\n**Top Finding:** AI-Powered Insights Generator (ICE: 342) is the #1 opportunity.\n\n@ORIN Please validate customer pain points for this feature. Target: Decision within 72 hours.`,
      mentions: [orin._id.toString()]
    });
    
    console.log("\n📨 Message sent to ORIN's task queue");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
