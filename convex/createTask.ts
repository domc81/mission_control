import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const createTask = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    assignees: v.array(v.string()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("urgent"))),
    creatorId: v.string(),
    parentTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: "pending",
      priority: args.priority || "medium",
      assignees: args.assignees,
      creatorId: args.creatorId,
      parentTaskId: args.parentTaskId,
      createdAt: now,
      updatedAt: now,
    });
    for (const assigneeId of args.assignees) {
      await ctx.db.insert("notifications", {
        agentId: assigneeId,
        type: "task_assigned",
        content: `New task: ${args.title}`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: now,
      });
    }
    await ctx.db.insert("activities", {
      agentId: args.creatorId,
      type: "task_started",
      message: `Created: ${args.title}`,
      relatedTaskId: taskId,
      timestamp: now,
    });
    return taskId;
  },
});
