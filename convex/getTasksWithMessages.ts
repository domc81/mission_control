import { query } from "./_generated/server";

export default query(async (ctx) => {
  // Get all tasks that have messages
  const allMessages = await ctx.db.query("messages").collect();
  
  // Group by taskId and get latest message per task
  const taskMessageMap = new Map<string, any>();
  for (const msg of allMessages) {
    const task = await ctx.db.get(msg.taskId);
    if (task) {
      const existing = taskMessageMap.get(msg.taskId);
      if (!existing || msg.createdAt > existing.message.createdAt) {
        taskMessageMap.set(msg.taskId, {
          task,
          message: msg,
          messageCount: 0,
        });
      }
    }
  }
  
  // Count messages per task
  for (const msg of allMessages) {
    const entry = taskMessageMap.get(msg.taskId);
    if (entry) {
      entry.messageCount++;
    }
  }
  
  return Array.from(taskMessageMap.values())
    .sort((a, b) => (b.message.createdAt || 0) - (a.message.createdAt || 0));
});