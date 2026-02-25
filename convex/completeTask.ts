// convex/completeTask.ts
// Mutation — called by agent on successful completion
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   resultSummary: string         // ≤500 chars plain text
//   outputDocumentId: v.optional(v.id("documents"))  // link to output doc if created
//   nextTaskIds: v.optional(v.array(v.id("tasks")))  // tasks to unblock/trigger (future)
// Returns: null
//
// Logic:
//   1. Patch task:
//        status: "completed"
//        completedAt: Date.now()
//        resultSummary: resultSummary
//        outputDocumentId: outputDocumentId (if provided)
//        claimedBy: agentName (preserve)
//        updatedAt: Date.now()
//   2. Insert completion message to task thread:
//        authorId: agentName
//        content: `[COMPLETE] ${resultSummary}`
//        mentions: []
//   3. Insert activities record:
//        type: "task_completed"
//        message: `${agentName} completed: ${task.title}`
//   4. Insert auditLog record:
//        eventType: "task_completed"
//        actorId: agentName
//        targetType: "task"
//        targetId: taskId
//        details: resultSummary (truncated to 500 chars)
//   5. For each agent listed in task.assignees other than agentName:
//        Insert notifications record:
//          agentId: <co-assignee>
//          type: "task_completed"
//          content: `${agentName} completed task: ${task.title}`
//          relatedTaskId: taskId
//          delivered: false

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const completeTask = mutation({
  args: {
    taskId: v.id("tasks"),
    agentName: v.string(),
    resultSummary: v.string(),
    outputDocumentId: v.optional(v.id("documents")),
    nextTaskIds: v.optional(v.array(v.id("tasks"))),
  },
  handler: async (ctx, { taskId, agentName, resultSummary, outputDocumentId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    await ctx.db.patch(task._id, {
      status: "completed",
      completedAt: Date.now(),
      resultSummary: resultSummary.length > 500 ? resultSummary.substring(0, 500) : resultSummary,
      outputDocumentId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("messages", {
      taskId,
      authorId: agentName,
      content: `[COMPLETE] ${resultSummary}`,
      mentions: [],
      createdAt: Date.now(),
    });
    await ctx.db.insert("activities", {
      agentId: agentName,
      type: "task_completed",
      message: `${agentName} completed: ${task.title}`,
      relatedTaskId: taskId,
      timestamp: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      eventType: "task_completed",
      actorId: agentName,
      targetType: "task",
      targetId: taskId,
      details: resultSummary.length > 500 ? resultSummary.substring(0, 500) : resultSummary,
      timestamp: Date.now(),
    });
    const coAssignees = task.assignees.filter(a => a !== agentName);
    for (const coAssignee of coAssignees) {
      await ctx.db.insert("notifications", {
        agentId: coAssignee,
        type: "task_completed",
        content: `${agentName} completed task: ${task.title}`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: Date.now(),
      });
    }
  },
});