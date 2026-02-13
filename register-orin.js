const https = require('https');
const fs = require("fs");

const CONVEX_URL = "https://exciting-warbler-274.eu-west-1.convex.cloud";
const AUTH_TOKEN = fs.readFileSync("/root/.openclaw/workspace-cestra/.convex-auth-token", "utf8").replace(/\s+/g, "").trim();
const DEPLOYMENT = "exciting-warbler-274";

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

async function main() {
  console.log("Registering ORIN agent via Convex API...");
  
  try {
    const result = await callConvex("registerAgent", {
      name: "ORIN",
      role: "Customer Research Specialist",
      capabilities: ["customer_interviews", "feedback_synthesis", "persona_development", "sentiment_analysis"],
      workspace: "/root/.openclaw/workspace-orin",
      heartbeatOffset: 4
    });
    
    console.log("✅ Success! ORIN registered with ID:", result);
    console.log("Agent ID:", result.toString());
    
    // Store the agent ID
    fs.writeFileSync("/root/.openclaw/workspace-orin/.agent-id", result.toString());
    console.log("Agent ID saved to /root/.openclaw/workspace-orin/.agent-id");
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

main();
