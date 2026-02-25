// convex/claimTask.ts
// Mutation — called by agent on heartbeat
// Args:
//   taskId: Id<"tasks">
//   agentName: string
// Returns:
//   { success: true, task: Doc<"tasks"> }
//   | { success: false, reason: "already_claimed" | "wrong_status" | "not_found" }
//
// Logic:
//   1. Load task by taskId
//   2. If not found → return { success: false, reason: "not_found" }
//   3. If task.status !== "pending" → return { success: false, reason: "wrong_status" }
//   4. If task.claimedBy is set and task.claimedBy !== agentName → return { success: false, reason: "already_claimed" }
//   5. Patch task:
//        status: "in_progress"
//        claimedBy: agentName
//        claimedAt: Date.now()
//        startedAt: Date.now()
//        retryCount: (task.retryCount ?? 0)  // preserve on retry, do not reset
//        updatedAt: Date.now()
//   6. Insert activities record:
//        agentId: agentName
//        type: "task_started"
//        message: `${agentName} claimed task: ${task.title}`
//        relatedTaskId: taskId
//        timestamp: Date.now()
//   7. Insert auditLog record:
//        eventType: "task_claimed"
//        actorId: agentName
//        targetType: "task"
//        targetId: taskId (as string)
//        details: JSON.stringify({ title: task.title, priority: task.priority })
//        timestamp: Date.now()
//   8. Return { success: true, task: updated task }

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const claimTask = mutation({
  args: {
    taskId: v.id("tasks"),
    agentName: v.string(),
  },
  handler: async (ctx, { taskId, agentName }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      return { success: false, reason: "not_found" };
    }
    if (task.status !== "pending") {
      return { success: false, reason: "wrong_status" };
    }
    if (task.claimedBy && task.claimedBy !== agentName) {
      return { success: false, reason: "already_claimed" };
    }
    const updatedTask = await ctx.db.patch(task._id, {
      status: "in_progress",
      claimedBy: agentName,
      claimedAt: Date.now(),
      startedAt: Date.now(),
      retryCount: (task.retryCount ?? 0),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("activities", {
      agentId: agentName,
      type: "task_started",
      message: `${agentName} claimed task: ${task.title}`,
      relatedTaskId: taskId,
      timestamp: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      eventType: "task_claimed",
      actorId: agentName,
      targetType: "task",
      targetId: taskId,
      details: JSON.stringify({ title: task.title, priority: task.priority }),
      timestamp: Date.now(),
    });
    return { success: true, task: updatedTask };
  },
});