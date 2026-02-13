import { query } from "./_generated/server";
import { v } from "convex/values";

export default query({
  args: {
    agentId: v.optional(v.string()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.unreadOnly) {
      const results = await ctx.db
        .query("notifications")
        .withIndex("by_delivered", (q) => q.eq("delivered", false))
        .collect();
      if (args.agentId) {
        return results.filter((n) => n.agentId === args.agentId);
      }
      return results;
    }

    if (args.agentId) {
      return await ctx.db
        .query("notifications")
        .withIndex("by_agent", (q) => q.eq("agentId", args.agentId as string))
        .collect();
    }

    return await ctx.db.query("notifications").collect();
  },
});
