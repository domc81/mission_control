import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    agentName: v.string(),
    status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("busy"), v.literal("offline"))),
  },
  handler: async (ctx, args) => {
    const agents = await ctx.db.query("agents").collect();
    const agent = agents.find((a) => a.name === args.agentName);

    if (agent) {
      await ctx.db.patch(agent._id, {
        heartbeatAt: Date.now(),
        status: args.status ?? "active",
        updatedAt: Date.now(),
      });
    }

    await ctx.db.insert("activities", {
      agentId: args.agentName,
      type: "heartbeat",
      message: `${args.agentName} heartbeat`,
      timestamp: Date.now(),
    });
  },
});
