// convex/respondToApproval.ts
// Mutation — called by Cestra's WhatsApp handler when Dominic responds
// Args:
//   taskId: Id<"tasks">
//   decision: v.union(v.literal("approved"), v.literal("rejected"))
//   respondedBy: string           // "dominic"
//   rejectionReason: v.optional(v.string())
// Returns: null
//
// Logic:
//   1. Load task
//   2. If task.approvalStatus !== "pending": throw "No pending approval for this task"
//   3. Patch task:
//        approvalStatus: decision
//        approvalRespondedAt: Date.now()
//        updatedAt: Date.now()
//   4. If decision === "approved":
//        Insert notification for task.claimedBy agent:
//          agentId: task.claimedBy
//          type: "task_assigned"   // re-use existing type as "resume" signal
//          content: `APPROVED: You may proceed with task "${task.title}"`
//          relatedTaskId: taskId
//          delivered: false
//   5. If decision === "rejected":
//        Patch task:
//          status: "archived"
//          deadLetterReason: `Rejected by Dominic: ${rejectionReason ?? "no reason given"}`
//        Insert notification for task.claimedBy agent:
//          agentId: task.claimedBy
//          type: "system"
//          content: `REJECTED: Task "${task.title}" was rejected by Dominic. Reason: ${rejectionReason ?? "none"}`
//          relatedTaskId: taskId
//          delivered: false
//        Insert notification for cestra:
//          same content, agentId: "cestra"
//   6. Mark approvalNotificationId as delivered if present
//   7. Insert auditLog:
//        eventType: "approval_responded"
//        actorId: respondedBy
//        targetType: "task"
//        details: JSON.stringify({ decision, rejectionReason })

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const respondToApproval = mutation({
  args: {
    taskId: v.id("tasks"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    respondedBy: v.string(),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, decision, respondedBy, rejectionReason }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    if (task.approvalStatus !== "pending") {
      throw new Error("No pending approval for this task");
    }
    await ctx.db.patch(task._id, {
      approvalStatus: decision,
      approvalRespondedAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (decision === "approved") {
      await ctx.db.insert("notifications", {
        agentId: task.claimedBy,
        type: "task_assigned",
        content: `APPROVED: You may proceed with task "${task.title}"`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.patch(task._id, {
        status: "archived",
        deadLetterReason: `Rejected by Dominic: ${rejectionReason ?? "no reason given"}`,
      });
      await ctx.db.insert("notifications", {
        agentId: task.claimedBy,
        type: "system",
        content: `REJECTED: Task "${task.title}" was rejected by Dominic. Reason: ${rejectionReason ?? "none"}`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("notifications", {
        agentId: "cestra",
        type: "system",
        content: `REJECTED: Task "${task.title}" was rejected by Dominic. Reason: ${rejectionReason ?? "none"}`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: Date.now(),
      });
    }
    if (task.approvalNotificationId) {
      await ctx.db.patch(task.approvalNotificationId, { delivered: true });
    }
    await ctx.db.insert("auditLog", {
      eventType: "approval_responded",
      actorId: respondedBy,
      targetType: "task",
      targetId: taskId,
      details: JSON.stringify({ decision, rejectionReason }),
      timestamp: Date.now(),
    });
  },
});