import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    documentId: v.id("documents"),
    authorId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const commentId = await ctx.db.insert("document_comments", {
      documentId: args.documentId,
      authorId: args.authorId,
      content: args.content,
      createdAt: now,
    });

    // Fetch document title for notification
    const doc = await ctx.db.get(args.documentId);
    const title = doc?.title ?? "a document";

    // Notify cestra
    await ctx.db.insert("notifications", {
      agentId: "cestra",
      type: "mention",
      content: `${args.authorId} commented on "${title}": ${args.content.slice(0, 200)}`,
      delivered: false,
      createdAt: now,
    });

    return commentId;
  },
});
