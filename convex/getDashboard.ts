import { query } from "./_generated/server";

export default query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const tasks = await ctx.db.query("tasks").collect();
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_timestamp")
      .order("desc")
      .take(20);
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_delivered", (q) => q.eq("delivered", false))
      .collect();

    return {
      agents,
      tasks: {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending").length,
        in_progress: tasks.filter((t) => t.status === "in_progress").length,
        review: tasks.filter((t) => t.status === "review").length,
        completed: tasks.filter((t) => t.status === "completed").length,
        archived: tasks.filter((t) => t.status === "archived").length,
      },
      recentActivity: activities,
      unreadNotifications: notifications.length,
    };
  },
});
