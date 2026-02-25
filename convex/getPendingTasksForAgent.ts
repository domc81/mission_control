// convex/getPendingTasksForAgent.ts
// Query — called by agent on heartbeat
// Args:
//   agentName: string
// Returns: Doc<"tasks">[]
//
// Logic:
//   1. Query tasks by status "pending" using by_status index
//   2. Filter: task.assignees.includes(agentName)
//   3. Filter: task.deadLettered !== true
//   4. Filter: task.approvalStatus !== "pending"   // do not claim tasks awaiting approval
//   5. Sort: by priority (urgent > high > medium > low > undefined), then by createdAt asc
//   6. Return array (may be empty)
//
// Priority sort order (numeric weight for sort):
//   urgent: 0, high: 1, medium: 2, low: 3, undefined: 4

import { query } from "./_generated/server";
import { v } from "convex/values";

export const getPendingTasksForAgent = query({
  args: {
    agentName: v.string(),
  },
  handler: async (ctx, { agentName }) => {
    const tasks = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "pending")).collect();
    const eligibleTasks = tasks
      .filter(task => task.assignees.includes(agentName))
      .filter(task => task.deadLettered !== true)
      .filter(task => task.approvalStatus !== "pending")
      .sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, undefined: 4 };
        const aPriority = priorityOrder[a.priority] ?? 4;
        const bPriority = priorityOrder[b.priority] ?? 4;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.createdAt - b.createdAt;
      });
    return eligibleTasks;
  },
});