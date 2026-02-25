// convex/getTaskById.ts
// Query — fetch a single task by ID
// Used by Cestra's WhatsApp approval handler to confirm task title after APPROVE/REJECT

import { query } from "./_generated/server";
import { v } from "convex/values";

export const getTaskById = query({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    return task ?? null;
  },
});
