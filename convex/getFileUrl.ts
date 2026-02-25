import { query } from "./_generated/server";
import { v } from "convex/values";

export default query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
