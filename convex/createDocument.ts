import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    title: v.string(),
    content: v.string(),
    type: v.union(v.literal("spec"), v.literal("memo"), v.literal("decision"), v.literal("other")),
    authorId: v.string(),
    relatedTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("documents", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});
