// convex/failTask.ts
// Mutation — called by agent on execution error
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   errorMessage: string          // truncated to 2000 chars
//   terminal: v.optional(v.boolean())  // if true, skip retry and dead-letter immediately
// Returns: { action: "retry" | "dead_letter" }
//
// Logic:
//   1. Load task
//   2. newRetryCount = (task.retryCount ?? 0) + 1
//   3. maxRetries = task.maxRetries ?? 3
//   4. If terminal === true OR newRetryCount > maxRetries:
//        → dead-letter path:
//          Patch task:
//            status: "pending"     // reset so it appears in the queue but is flagged
//            deadLettered: true
//            deadLetteredAt: Date.now()
//            deadLetterReason: errorMessage (truncated to 500 chars)
//            retryCount: newRetryCount
//            claimedBy: undefined   // release claim
//            updatedAt: Date.now()
//          Insert notification for Cestra:
//            agentId: "cestra"
//            type: "system"
//            content: `DEAD LETTER: Task "${task.title}" failed ${newRetryCount} times. Last error: ${errorMessage.substring(0,200)}`
//            relatedTaskId: taskId
//            delivered: false
//          Insert auditLog: eventType: "task_dead_lettered"
//          Return { action: "dead_letter" }
//   5. Else:
//        → retry path:
//          Patch task:
//            status: "pending"     // back to pending so it gets re-picked-up
//            claimedBy: undefined  // release claim so any eligible agent can retry
//            claimedAt: undefined
//            retryCount: newRetryCount
//            failedAt: Date.now()
//            lastError: errorMessage (truncated to 2000 chars)
//            updatedAt: Date.now()
//          Insert activities record: type "task_started", message: `Retry ${newRetryCount}/${maxRetries} for: ${task.title}`
//          Return { action: "retry" }

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const failTask = mutation({
  args: {
    taskId: v.id("tasks"),
    agentName: v.string(),
    errorMessage: v.string(),
    terminal: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskId, agentName, errorMessage, terminal }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const newRetryCount = (task.retryCount ?? 0) + 1;
    const maxRetries = task.maxRetries ?? 3;
    if (terminal === true || newRetryCount > maxRetries) {
      await ctx.db.patch(task._id, {
        status: "pending",
        deadLettered: true,
        deadLetteredAt: Date.now(),
        deadLetterReason: errorMessage.length > 500 ? errorMessage.substring(0, 500) : errorMessage,
        retryCount: newRetryCount,
        claimedBy: undefined,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("notifications", {
        agentId: "cestra",
        type: "system",
        content: `DEAD LETTER: Task "${task.title}" failed ${newRetryCount} times. Last error: ${errorMessage.substring(0, 200)}`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("auditLog", {
        eventType: "task_dead_lettered",
        actorId: agentName,
        targetType: "task",
        targetId: taskId,
        details: JSON.stringify({ retryCount: newRetryCount, lastError: errorMessage }),
        timestamp: Date.now(),
      });
      return { action: "dead_letter" };
    } else {
      await ctx.db.patch(task._id, {
        status: "pending",
        claimedBy: undefined,
        claimedAt: undefined,
        retryCount: newRetryCount,
        failedAt: Date.now(),
        lastError: errorMessage.length > 2000 ? errorMessage.substring(0, 2000) : errorMessage,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("activities", {
        agentId: agentName,
        type: "task_started",
        message: `Retry ${newRetryCount}/${maxRetries} for: ${task.title}`,
        relatedTaskId: taskId,
        timestamp: Date.now(),
      });
      return { action: "retry" };
    }
  },
});