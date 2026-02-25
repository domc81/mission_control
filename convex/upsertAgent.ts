import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    name: v.string(),
    role: v.string(),
    capabilities: v.optional(v.array(v.string())),
    workspace: v.optional(v.string()),
    heartbeatOffset: v.optional(v.number()),
    sessionKey: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("busy"), v.literal("offline"))),
  },
  handler: async (ctx, args) => {
    const agents = await ctx.db.query("agents").collect();
    const existing = agents.find((a) => a.name === args.name);

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: args.role,
        capabilities: args.capabilities,
        workspace: args.workspace,
        heartbeatOffset: args.heartbeatOffset,
        sessionKey: args.sessionKey,
        status: args.status ?? existing.status,
        updatedAt: Date.now(),
      });
      return { id: existing._id, action: "updated" };
    } else {
      const id = await ctx.db.insert("agents", {
        name: args.name,
        role: args.role,
        capabilities: args.capabilities ?? [],
        workspace: args.workspace,
        heartbeatOffset: args.heartbeatOffset ?? 0,
        sessionKey: args.sessionKey,
        status: args.status ?? "idle",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { id, action: "created" };
    }
  },
});
