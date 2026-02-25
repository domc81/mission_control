// convex/getDeadLetterQueue.ts
// Query — used by Mission Control and Cestra
// Args: none
// Returns: Doc<"tasks">[] where deadLettered === true
//
// Logic:
//   Query tasks using by_dead_letter index where deadLettered === true
//   Order by deadLetteredAt desc

import { query } from "./_generated/server";

export const getDeadLetterQueue = query({
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").withIndex("by_dead_letter", (q) => q.eq("deadLettered", true)).collect();
    return tasks.sort((a, b) => b.deadLetteredAt - a.deadLetteredAt);
  },
});