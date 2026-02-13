import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.documentId);
  },
});
