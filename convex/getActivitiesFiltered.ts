import { query } from "./_generated/server";
import { v } from "convex/values";

export default query({
  args: {
    type: v.optional(v.string()),
    agentId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let activities = await ctx.db
      .query("activities")
      .withIndex("by_timestamp")
      .order("desc")
      .take(args.limit ?? 50);

    if (args.type) {
      activities = activities.filter((a) => a.type === args.type);
    }
    if (args.agentId) {
      activities = activities.filter((a) => a.agentId === args.agentId);
    }

    return activities;
  },
});
