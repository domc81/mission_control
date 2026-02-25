const { ConvexHttpClient } = require("convex/browser");

const client = new ConvexHttpClient("https://exciting-warbler-274.eu-west-1.convex.cloud");

const fs = require('fs');
const content = fs.readFileSync('/root/.openclaw/workspace-cestra/JS_RENDERING_RESEARCH_REPORT.md', 'utf-8');

async function uploadReport() {
  try {
    const result = await client.mutation("createDocument", {
      title: "JavaScript Rendering Solution Research",
      content: content,
      type: "spec",
      authorId: "j9794m411dkxq7cxnxp3q64ddh80r3dd" // VEDA's Convex ID
    });
    console.log("✅ Document uploaded to Convex:", result);
  } catch (error) {
    console.error("❌ Upload failed:", error.message);
  }
}

uploadReport();
