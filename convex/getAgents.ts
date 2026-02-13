import { query } from "./_generated/server";

export default query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("agents").collect();
  },
});
