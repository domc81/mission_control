import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    taskId: v.id("tasks"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("completed"),
      v.literal("archived")
    ),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.status === "completed") {
      updates.completedAt = Date.now();
    }
    await ctx.db.patch(args.taskId, updates);

    await ctx.db.insert("activities", {
      agentId: "dashboard",
      type: "task_started",
      message: `Task status changed to ${args.status}`,
      relatedTaskId: args.taskId,
      timestamp: Date.now(),
    });
  },
});
