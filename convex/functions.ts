import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { encryptCredential, decryptCredential } from "./encryption";

// Register a new agent
export const registerAgent = mutation({
  args: {
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      role: args.role,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    });
    
    // Log registration
    await ctx.db.insert("auditLog", {
      eventType: "agent_registered",
      actorId: "system",
      targetType: "agent",
      targetId: agentId.toString(),
      details: `Agent ${args.name} (${args.role}) registered`,
      timestamp: now,
    });
    
    return agentId;
  },
});

// Update agent heartbeat
export const heartbeat = mutation({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    await ctx.db.patch(args.agentId, {
      heartbeatAt: now,
      updatedAt: now,
    });
  },
});

// Update agent status
export const updateStatus = mutation({
  args: {
    agentId: v.id("agents"),
    status: v.union(v.literal("active"), v.literal("idle"), v.literal("busy"), v.literal("offline")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

// Create a task
export const createTask = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    assignees: v.array(v.string()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("urgent"))),
    creatorId: v.string(),
    parentTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const taskId = await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: "pending",
      priority: args.priority || "medium",
      assignees: args.assignees,
      creatorId: args.creatorId,
      parentTaskId: args.parentTaskId,
      createdAt: now,
      updatedAt: now,
    });
    
    // Create notifications for assignees
    for (const assigneeId of args.assignees) {
      await ctx.db.insert("notifications", {
        agentId: assigneeId,
        type: "task_assigned",
        content: `New task assigned: ${args.title}`,
        relatedTaskId: taskId,
        delivered: false,
        createdAt: now,
      });
    }
    
    // Log activity
    await ctx.db.insert("activities", {
      agentId: args.creatorId,
      type: "task_started",
      message: `Created task: ${args.title}`,
      relatedTaskId: taskId,
      timestamp: now,
    });
    
    return taskId,
  },
});

// Update task status
export const updateTaskStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: v.union(v.literal("pending"), v.literal("in_progress"), v.literal("review"), v.literal("completed"), v.literal("archived")),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const updates: Record<string, any> = {
      status: args.status,
      updatedAt: now,
    };
    
    if (args.status === "completed") {
      updates.completedAt = now;
    }
    
    await ctx.db.patch(args.taskId, updates);
    
    // Notify all assignees
    const task = await ctx.db.get(args.taskId);
    if (task) {
      for (const assigneeId of task.assignees) {
        await ctx.db.insert("notifications", {
          agentId: assigneeId,
          type: "task_completed",
          content: `Task "${task.title}" marked as ${args.status}`,
          relatedTaskId: args.taskId,
          delivered: false,
          createdAt: now,
        });
      }
    }
    
    await ctx.db.insert("activities", {
      agentId: args.agentId,
      type: args.status === "completed" ? "task_completed" : "task_started",
      message: `Task "${task?.title || args.taskId}" status: ${args.status}`,
      relatedTaskId: args.taskId,
      timestamp: now,
    });
  },
});

// Store encrypted credential
export const storeCredential = mutation({
  args: {
    agentId: v.string(),
    service: v.string(),
    plaintextKey: v.string(),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Encrypt the credential
    const { encryptedKey, iv, tag } = await encryptCredential(args.plaintextKey);
    
    const credentialId = await ctx.db.insert("credentials", {
      agentId: args.agentId,
      service: args.service,
      encryptedKey,
      iv,
      tag,
      permissions: args.permissions,
      createdAt: now,
      updatedAt: now,
    });
    
    // Audit log
    await ctx.db.insert("auditLog", {
      eventType: "credential_stored",
      actorId: args.agentId,
      targetType: "credential",
      targetId: credentialId.toString(),
      details: `Stored credential for ${args.service}`,
      timestamp: now,
    });
    
    return credentialId;
  },
});

// Retrieve and decrypt credential
export const getCredential = mutation({
  args: {
    agentId: v.id("agents"),
    credentialId: v.id("credentials"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const credential = await ctx.db.get(args.credentialId);
    if (!credential) {
      throw new Error("Credential not found");
    }
    
    // Verify agent has access
    if (credential.agentId !== args.agentId.toString()) {
      await ctx.db.insert("auditLog", {
        eventType: "credential_access_denied",
        actorId: args.agentId.toString(),
        targetType: "credential",
        targetId: args.credentialId.toString(),
        details: `Unauthorized access attempt to ${credential.service}`,
        timestamp: now,
      });
      throw new Error("Access denied");
    }
    
    // Decrypt and return
    const plaintext = await decryptCredential(
      credential.encryptedKey,
      credential.iv,
      credential.tag
    );
    
    // Update access time
    await ctx.db.patch(args.credentialId, {
      lastAccessedAt: now,
    });
    
    // Audit log
    await ctx.db.insert("auditLog", {
      eventType: "credential_accessed",
      actorId: args.agentId.toString(),
      targetType: "credential",
      targetId: args.credentialId.toString(),
      details: `Accessed ${credential.service} credential`,
      timestamp: now,
    });
    
    return plaintext;
  },
});

// Send a message in a task thread
export const sendMessage = mutation({
  args: {
    taskId: v.id("tasks"),
    authorId: v.string(),
    content: v.string(),
    mentions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const messageId = await ctx.db.insert("messages", {
      taskId: args.taskId,
      authorId: args.authorId,
      content: args.content,
      mentions: args.mentions,
      createdAt: now,
    });
    
    // Create notifications for mentions
    for (const mentionedId of args.mentions) {
      await ctx.db.insert("notifications", {
        agentId: mentionedId,
        type: "mention",
        content: `${args.authorId} mentioned you: "${args.content.slice(0, 50)}..."`,
        relatedTaskId: args.taskId,
        delivered: false,
        createdAt: now,
      });
    }
    
    await ctx.db.insert("activities", {
      agentId: args.authorId,
      type: "message_sent",
      message: `Sent message in task`,
      relatedTaskId: args.taskId,
      timestamp: now,
    });
    
    return messageId;
  },
});

// Get undelivered notifications for an agent
export const getNotifications = query({
  args: {
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .filter((q) => q.eq(q.field("delivered"), false))
      .collect();
  },
});

// Mark notification as delivered
export const markNotificationDelivered = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, {
      delivered: true,
    });
  },
});

// Get all active tasks
export const getActiveTasks = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_status")
      .filter((q) => 
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "in_progress"),
          q.eq(q.field("status"), "review")
        )
      )
      .collect();
  },
});

// Get all agents
export const getAllAgents = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("agents").collect();
  },
});

// Get recent activities
export const getRecentActivities = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_timestamp")
      .order("desc")
      .take(args.limit || 50);
    
    // Join with agent names
    const agents = await ctx.db.query("agents").collect();
    const agentMap = new Map(agents.map(a => [a._id.toString(), a]));
    
    return activities.map(a => ({
      ...a,
      agentName: agentMap.get(a.agentId)?.name || a.agentId,
    }));
  },
});

// Get dashboard data
export const getDashboard = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const tasks = await ctx.db.query("tasks").collect();
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_timestamp")
      .order("desc")
      .take(20);
    
    const agentsMap = new Map(agents.map(a => [a._id.toString(), a]));
    
    const recentActivities = activities.map(a => ({
      ...a,
      agentName: agentsMap.get(a.agentId)?.name || a.agentId,
    }));
    
    return {
      agents: agents.map(a => ({
        id: a._id.toString(),
        name: a.name,
        role: a.role,
        status: a.status,
        lastHeartbeat: a.heartbeatAt,
      })),
      taskStats: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === "pending").length,
        inProgress: tasks.filter(t => t.status === "in_progress").length,
        completed: tasks.filter(t => t.status === "completed").length,
      },
      recentActivities,
    };
  },
});
