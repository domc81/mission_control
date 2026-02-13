import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { delivered: true });
  },
});
