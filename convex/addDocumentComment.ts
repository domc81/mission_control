import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

export default mutation({
  args: {
    documentId: v.id("documents"),
    authorId:   v.string(),
    content:    v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.content.trim()) {
      throw new ConvexError("Comment content cannot be empty");
    }
    const commentId = await ctx.db.insert("documentComments", {
      documentId: args.documentId,
      authorId:   args.authorId,
      content:    args.content.trim(),
      createdAt:  Date.now(),
    });
    return { commentId };
  },
});