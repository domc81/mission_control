import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  agents: defineTable({
    name: v.string(),
    role: v.string(),
    capabilities: v.optional(v.array(v.string())),
    workspace: v.optional(v.string()),
    heartbeatOffset: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("busy"), v.literal("offline"))),
    sessionKey: v.optional(v.string()),
    heartbeatAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]).index("by_heartbeat", ["heartbeatAt"]),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("in_progress"), v.literal("review"), v.literal("completed"), v.literal("archived")),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("urgent"))),
    assignees: v.array(v.string()),
    creatorId: v.string(),
    parentTaskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_status", ["status"]).index("by_assignees", ["assignees"]),

  messages: defineTable({
    taskId: v.id("tasks"),
    authorId: v.string(),
    content: v.string(),
    mentions: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_task", ["taskId"]),

  credentials: defineTable({
    agentId: v.string(),
    service: v.string(),
    encryptedKey: v.string(),
    iv: v.string(),
    tag: v.string(),
    permissions: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastAccessedAt: v.optional(v.number()),
  }).index("by_agent", ["agentId"]).index("by_service", ["service"]),

  auditLog: defineTable({
    eventType: v.string(),
    actorId: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    details: v.optional(v.string()),
    timestamp: v.number(),
  }).index("by_actor", ["actorId"]).index("by_timestamp", ["timestamp"]),

  notifications: defineTable({
    agentId: v.string(),
    type: v.union(v.literal("mention"), v.literal("task_assigned"), v.literal("task_completed"), v.literal("system")),
    content: v.string(),
    relatedTaskId: v.optional(v.id("tasks")),
    delivered: v.boolean(),
    createdAt: v.number(),
  }).index("by_agent", ["agentId"]).index("by_delivered", ["delivered"]),

  documents: defineTable({
    title: v.string(),
    content: v.string(),
    type: v.union(v.literal("spec"), v.literal("memo"), v.literal("decision"), v.literal("other")),
    authorId: v.string(),
    relatedTaskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  activities: defineTable({
    agentId: v.string(),
    type: v.union(v.literal("heartbeat"), v.literal("task_started"), v.literal("task_completed"), v.literal("message_sent"), v.literal("credential_accessed")),
    message: v.string(),
    relatedTaskId: v.optional(v.id("tasks")),
    timestamp: v.number(),
  }).index("by_agent", ["agentId"]).index("by_timestamp", ["timestamp"]),
});
