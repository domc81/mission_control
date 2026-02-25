import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    type: v.optional(v.union(v.literal("spec"), v.literal("memo"), v.literal("decision"), v.literal("guide"), v.literal("other"))),
    storageId: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { documentId, ...fields } = args;
    const updates: Record<string, any> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }
    await ctx.db.patch(documentId, updates);
  },
});
