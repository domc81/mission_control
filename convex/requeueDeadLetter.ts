// convex/requeueDeadLetter.ts
// Mutation — called by Cestra or Dominic to reset a dead-lettered task
// Args:
//   taskId: Id<"tasks">
//   resetRetryCount: v.optional(v.boolean())  // default false
// Returns: null
//
// Logic:
//   1. Patch task:
//        deadLettered: false
//        deadLetteredAt: undefined
//        deadLetterReason: undefined
//        status: "pending"
//        claimedBy: undefined
//        retryCount: resetRetryCount ? 0 : task.retryCount
//        updatedAt: Date.now()
//   2. Insert auditLog: eventType: "task_requeued"

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const requeueDeadLetter = mutation({
  args: {
    taskId: v.id("tasks"),
    resetRetryCount: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskId, resetRetryCount }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    await ctx.db.patch(task._id, {
      deadLettered: false,
      deadLetteredAt: undefined,
      deadLetterReason: undefined,
      status: "pending",
      claimedBy: undefined,
      retryCount: resetRetryCount ? 0 : task.retryCount,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      eventType: "task_requeued",
      actorId: "cestra", // assuming called by cestra
      targetType: "task",
      targetId: taskId,
      details: JSON.stringify({ resetRetryCount }),
      timestamp: Date.now(),
    });
  },
});