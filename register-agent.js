const { ConvexClient } = require("convex");
const fs = require("fs");

const CONVEX_URL = "https://exciting-warbler-274.eu-west-1.convex.cloud";
const AUTH_TOKEN = fs.readFileSync("/root/.openclaw/workspace-cestra/.convex-auth-token", "utf8").replace(/\s+/g, "").trim();

async function main() {
  console.log("Connecting to Convex...");
  const client = new ConvexClient(CONVEX_URL, {
    authToken: AUTH_TOKEN
  });

  console.log("Registering Cestra as first agent...");
  
  try {
    const agentId = await client.mutation("registerAgent", {
      name: "Cestra",
      role: "Squad Lead"
    });
    
    console.log("✅ Success! Cestra registered with ID:", agentId);
    console.log("Agent ID (for heartbeat):", agentId.toString());
    
    // Store the agent ID for later use
    fs.writeFileSync("/root/.openclaw/workspace-cestra/.agent-id", agentId.toString());
    console.log("Agent ID saved to .agent-id");
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.stack) console.error(error.stack);
  }
}

main();
