import { query } from "./_generated/server";

export default query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").collect();

    const grouped: Record<string, typeof tasks> = {};
    for (const task of tasks) {
      const status = task.status;
      if (!grouped[status]) grouped[status] = [];
      grouped[status].push(task);
    }

    return grouped;
  },
});
