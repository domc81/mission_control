// convex/requestApproval.ts
// Mutation — called by agent when encountering a gated action
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   actionDescription: string     // what the agent wants to do (≤500 chars)
//   approvalTier: "notify" | "gate"
//   timeoutMinutes: v.optional(v.number())  // for "notify" tier only; default 30
// Returns: { notificationId: Id<"notifications"> }
//
// Logic:
//   1. Load task
//   2. Patch task:
//        approvalTier: approvalTier
//        approvalStatus: "pending"
//        approvalRequestedAt: Date.now()
//        updatedAt: Date.now()
//        // do NOT change task.status — task remains in_progress but paused
//   3. Build notification content string:
//        "🔐 APPROVAL REQUIRED\n" +
//        `Task: ${task.title}\n` +
//        `Agent: ${agentName}\n` +
//        `Tier: ${approvalTier.toUpperCase()}\n` +
//        `Action: ${actionDescription}\n` +
//        (approvalTier === "notify" ? `Auto-proceeds in ${timeoutMinutes ?? 30} min if no response.\n` : "Task is BLOCKED until you respond.\n") +
//        `Reply APPROVE <taskId> or REJECT <taskId> via WhatsApp.`
//   4. Insert notifications record:
//        agentId: "dominic"         // special sentinel — Cestra's WhatsApp relay watches for this
//        type: "approval_request"
//        content: <built string>
//        relatedTaskId: taskId
//        delivered: false
//        createdAt: Date.now()
//   5. Patch task:
//        approvalNotificationId: <new notification _id as string>
//   6. Insert auditLog:
//        eventType: "approval_requested"
//        actorId: agentName
//        targetType: "task"
//        targetId: taskId
//        details: JSON.stringify({ tier: approvalTier, action: actionDescription })
//   7. Return { notificationId: <_id> }

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const requestApproval = mutation({
  args: {
    taskId: v.id("tasks"),
    agentName: v.string(),
    actionDescription: v.string(),
    approvalTier: v.union(v.literal("notify"), v.literal("gate")),
    timeoutMinutes: v.optional(v.number()),
  },
  handler: async (ctx, { taskId, agentName, actionDescription, approvalTier, timeoutMinutes }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    await ctx.db.patch(task._id, {
      approvalTier,
      approvalStatus: "pending",
      approvalRequestedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const timeout = timeoutMinutes ?? 30;
    const content = `🔐 APPROVAL REQUIRED\nTask: ${task.title}\nAgent: ${agentName}\nTier: ${approvalTier.toUpperCase()}\nAction: ${actionDescription}\n${approvalTier === "notify" ? `Auto-proceeds in ${timeout} min if no response.\n` : "Task is BLOCKED until you respond.\n"}Reply APPROVE <taskId> or REJECT <taskId> via WhatsApp.`;
    const notificationId = await ctx.db.insert("notifications", {
      agentId: "dominic",
      type: "approval_request",
      content,
      relatedTaskId: taskId,
      delivered: false,
      createdAt: Date.now(),
    });
    await ctx.db.patch(task._id, {
      approvalNotificationId: notificationId.toString(),
    });
    await ctx.db.insert("auditLog", {
      eventType: "approval_requested",
      actorId: agentName,
      targetType: "task",
      targetId: taskId,
      details: JSON.stringify({ tier: approvalTier, action: actionDescription }),
      timestamp: Date.now(),
    });
    return { notificationId };
  },
});