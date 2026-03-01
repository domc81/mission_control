// convex/sendMessage.ts
// Mutation
// Args:
//   taskId: Id<"tasks">
//   authorId: string
//   content: string        // must start with a valid prefix tag (see 5.1)
//   mentions: string[]     // agent names to notify
// Returns: { messageId: Id<"messages"> }
//
// Logic:
//   1. Insert message record
//   2. For each name in mentions:
//        Insert notification:
//          agentId: name
//          type: "mention"
//          content: `${authorId} mentioned you in task "${task.title}": ${content.substring(0,200)}`
//          relatedTaskId: taskId
//          delivered: false
//   3. Return { messageId }

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    taskId: v.id("tasks"),
    authorId: v.string(),
    content: v.string(),
    mentions: v.array(v.string()),
  },
  handler: async (ctx, { taskId, authorId, content, mentions }) => {
    const task = await ctx.db.get(taskId);
    const messageId = await ctx.db.insert("messages", {
      taskId,
      authorId,
      content,
      mentions,
      createdAt: Date.now(),
    });
    for (const mention of mentions) {
      await ctx.db.insert("notifications", {
        agentId: mention,
        type: "mention",
        content: `${authorId} mentioned you in task "${task.title}": ${content.substring(0, 200)}`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: Date.now(),
      });
    }
    return { messageId };
  },
});