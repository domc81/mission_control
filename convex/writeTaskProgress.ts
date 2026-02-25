// convex/writeTaskProgress.ts
// Mutation — called by agent during execution
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   progressNote: string          // human-readable update (≤500 chars)
//   percentComplete: v.optional(v.number())  // 0-100, optional
// Returns: null
//
// Logic:
//   1. Insert a message to the task's thread:
//        taskId: taskId
//        authorId: agentName
//        content: `[PROGRESS] ${progressNote}` (+ " (${percentComplete}%)" if provided)
//        mentions: []
//        createdAt: Date.now()
//   2. Insert activities record:
//        agentId: agentName
//        type: "task_started"    // re-use existing type — represents active work
//        message: progressNote (truncated to 200 chars)
//        relatedTaskId: taskId
//        timestamp: Date.now()

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const writeTaskProgress = mutation({
  args: {
    taskId: v.id("tasks"),
    agentName: v.string(),
    progressNote: v.string(),
    percentComplete: v.optional(v.number()),
  },
  handler: async (ctx, { taskId, agentName, progressNote, percentComplete }) => {
    const content = `[PROGRESS] ${progressNote}${percentComplete !== undefined ? ` (${percentComplete}%)` : ""}`;
    await ctx.db.insert("messages", {
      taskId,
      authorId: agentName,
      content,
      mentions: [],
      createdAt: Date.now(),
    });
    await ctx.db.insert("activities", {
      agentId: agentName,
      type: "task_started",
      message: progressNote.length > 200 ? progressNote.substring(0, 200) : progressNote,
      relatedTaskId: taskId,
      timestamp: Date.now(),
    });
  },
});