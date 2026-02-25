# AUTONOMOUS_EXECUTION_LOOP.md
**Spec authored by:** Architect  
**Date:** 2026-02-23  
**Status:** ✅ APPROVED by Dominic — 2026-02-23 19:15 GMT+1. Tier list confirmed as proposed. Ready for Koda implementation.  
**Implementer:** Koda (Builder agent)

---

## Overview

This spec defines the complete autonomous execution loop for the DC81 agent squad. It wires together the existing OpenClaw agent runtime, the Convex database, WhatsApp notifications, and human approval gates into a coherent, safe, self-sustaining system.

The loop closes when: tasks assigned in Convex are automatically detected by agents on heartbeat, executed (or gated for approval), and results written back to Convex — all without manual intervention from Dominic except for explicitly tiered approvals.

**Stack in scope:**
- OpenClaw agents (Cestra, VEDA, ORIN, Vision, Loki, Architect, Koda, QA)
- Convex DB at `https://exciting-warbler-274.eu-west-1.convex.cloud`
- Existing schema: `agents`, `tasks`, `messages`, `credentials`, `notifications`, `documents`, `activities`, `auditLog`
- WhatsApp as the approval notification channel
- No new infrastructure

---

## 1. Schema Extensions Required

The existing schema must be extended before any execution logic is built. These are the minimum additions required.

### 1.1 Extended `tasks` table fields

Add the following optional fields to the existing `tasks` table via a schema migration:

```typescript
// Additional fields to add to the tasks table in schema.ts
claimedBy: v.optional(v.string()),          // agent name that claimed this task
claimedAt: v.optional(v.number()),          // epoch ms of claim
startedAt: v.optional(v.number()),          // epoch ms when execution began
failedAt: v.optional(v.number()),           // epoch ms of last failure
retryCount: v.optional(v.number()),         // number of execution attempts
maxRetries: v.optional(v.number()),         // max allowed retries (default 3)
lastError: v.optional(v.string()),          // last error message/stack (truncated to 2000 chars)
approvalTier: v.optional(v.union(
  v.literal("auto"),                        // no approval needed
  v.literal("notify"),                      // notify Dominic but auto-proceed after 30min
  v.literal("gate"),                        // hard stop — must receive explicit approval
  v.literal("blocked")                      // permanently blocked until manually reviewed
)),
approvalStatus: v.optional(v.union(
  v.literal("pending"),                     // waiting for human decision
  v.literal("approved"),                    // Dominic approved
  v.literal("rejected")                     // Dominic rejected
)),
approvalRequestedAt: v.optional(v.number()), // epoch ms when approval was requested
approvalRespondedAt: v.optional(v.number()), // epoch ms when approval was received
approvalNotificationId: v.optional(v.string()), // Convex notifications._id for this gate
resultSummary: v.optional(v.string()),      // plain-text summary of task output (≤500 chars)
outputDocumentId: v.optional(v.id("documents")), // link to full output document
deadLettered: v.optional(v.boolean()),      // true if moved to dead-letter state
deadLetteredAt: v.optional(v.number()),
deadLetterReason: v.optional(v.string()),
```

**Migration file:** `convex/migrations/001_extend_tasks.ts`

> **Assumption:** Convex schema changes are applied by pushing updated `schema.ts` via `npx convex deploy`. No separate migration runner is needed for schema-only field additions since all new fields are `optional`. Koda must update `schema.ts` in place and redeploy.

### 1.2 Extended `notifications` table — new types

Add two new notification `type` literals to the existing union:

```typescript
// In schema.ts, extend the notifications.type union:
v.literal("approval_request"),   // task requires human approval
v.literal("approval_timeout"),   // approval not received within timeout window
```

### 1.3 New index on `tasks`

Add to the `tasks` table definition:

```typescript
.index("by_assignee_status", ["assignees", "status"])
.index("by_claimed", ["claimedBy", "status"])
.index("by_dead_letter", ["deadLettered"])
```

---

## 2. New Convex Functions Required

All new Convex functions follow the existing file-per-function pattern in `convex/`.

### 2.1 `convex/claimTask.ts` — Atomic task claim mutation

**Purpose:** An agent atomically claims a pending task. Prevents double-pickup.

```typescript
// convex/claimTask.ts
// Mutation — called by agent on heartbeat
// Args:
//   taskId: Id<"tasks">
//   agentName: string
// Returns:
//   { success: true, task: Doc<"tasks"> }
//   | { success: false, reason: "already_claimed" | "wrong_status" | "not_found" }
//
// Logic:
//   1. Load task by taskId
//   2. If not found → return { success: false, reason: "not_found" }
//   3. If task.status !== "pending" → return { success: false, reason: "wrong_status" }
//   4. If task.claimedBy is set and task.claimedBy !== agentName → return { success: false, reason: "already_claimed" }
//   5. Patch task:
//        status: "in_progress"
//        claimedBy: agentName
//        claimedAt: Date.now()
//        startedAt: Date.now()
//        retryCount: (task.retryCount ?? 0)  // preserve on retry, do not reset
//        updatedAt: Date.now()
//   6. Insert activities record:
//        agentId: agentName
//        type: "task_started"
//        message: `${agentName} claimed task: ${task.title}`
//        relatedTaskId: taskId
//        timestamp: Date.now()
//   7. Insert auditLog record:
//        eventType: "task_claimed"
//        actorId: agentName
//        targetType: "task"
//        targetId: taskId (as string)
//        details: JSON.stringify({ title: task.title, priority: task.priority })
//        timestamp: Date.now()
//   8. Return { success: true, task: updated task }
```

### 2.2 `convex/writeTaskProgress.ts` — Agent progress/log write-back

**Purpose:** Agents write structured progress updates mid-execution.

```typescript
// convex/writeTaskProgress.ts
// Mutation — called by agent during execution
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   progressNote: string          // human-readable update (≤500 chars)
//   percentComplete: v.optional(v.number())  // 0-100, optional
// Returns: null
//
// Logic:
//   1. Insert a message to the task's thread:
//        taskId: taskId
//        authorId: agentName
//        content: `[PROGRESS] ${progressNote}` (+ " (${percentComplete}%)" if provided)
//        mentions: []
//        createdAt: Date.now()
//   2. Insert activities record:
//        agentId: agentName
//        type: "task_started"    // re-use existing type — represents active work
//        message: progressNote (truncated to 200 chars)
//        relatedTaskId: taskId
//        timestamp: Date.now()
```

### 2.3 `convex/completeTask.ts` — Task completion write-back

**Purpose:** Agent writes final result and marks task complete.

```typescript
// convex/completeTask.ts
// Mutation — called by agent on successful completion
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   resultSummary: string         // ≤500 chars plain text
//   outputDocumentId: v.optional(v.id("documents"))  // link to output doc if created
//   nextTaskIds: v.optional(v.array(v.id("tasks")))  // tasks to unblock/trigger (future)
// Returns: null
//
// Logic:
//   1. Patch task:
//        status: "completed"
//        completedAt: Date.now()
//        resultSummary: resultSummary
//        outputDocumentId: outputDocumentId (if provided)
//        claimedBy: agentName (preserve)
//        updatedAt: Date.now()
//   2. Insert completion message to task thread:
//        authorId: agentName
//        content: `[COMPLETE] ${resultSummary}`
//        mentions: []
//   3. Insert activities record:
//        type: "task_completed"
//        message: `${agentName} completed: ${task.title}`
//   4. Insert auditLog record:
//        eventType: "task_completed"
//        actorId: agentName
//        targetType: "task"
//        targetId: taskId
//        details: resultSummary (truncated to 500 chars)
//   5. For each agent listed in task.assignees other than agentName:
//        Insert notifications record:
//          agentId: <co-assignee>
//          type: "task_completed"
//          content: `${agentName} completed task: ${task.title}`
//          relatedTaskId: taskId
//          delivered: false
//          createdAt: Date.now()
```

### 2.4 `convex/failTask.ts` — Task failure and retry logic

**Purpose:** Agent reports failure; retry or dead-letter logic applied.

```typescript
// convex/failTask.ts
// Mutation — called by agent on execution error
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   errorMessage: string          // truncated to 2000 chars
//   terminal: v.optional(v.boolean())  // if true, skip retry and dead-letter immediately
// Returns: { action: "retry" | "dead_letter" }
//
// Logic:
//   1. Load task
//   2. newRetryCount = (task.retryCount ?? 0) + 1
//   3. maxRetries = task.maxRetries ?? 3
//   4. If terminal === true OR newRetryCount > maxRetries:
//        → dead-letter path:
//          Patch task:
//            status: "pending"     // reset so it appears in the queue but is flagged
//            deadLettered: true
//            deadLetteredAt: Date.now()
//            deadLetterReason: errorMessage (truncated to 500 chars)
//            retryCount: newRetryCount
//            claimedBy: undefined   // release claim
//            updatedAt: Date.now()
//          Insert notification for Cestra:
//            agentId: "cestra"
//            type: "system"
//            content: `DEAD LETTER: Task "${task.title}" failed ${newRetryCount} times. Last error: ${errorMessage.substring(0,200)}`
//            relatedTaskId: taskId
//            delivered: false
//          Insert auditLog: eventType: "task_dead_lettered"
//          Return { action: "dead_letter" }
//   5. Else:
//        → retry path:
//          Patch task:
//            status: "pending"     // back to pending so it gets re-picked-up
//            claimedBy: undefined  // release claim so any eligible agent can retry
//            claimedAt: undefined
//            retryCount: newRetryCount
//            failedAt: Date.now()
//            lastError: errorMessage (truncated to 2000 chars)
//            updatedAt: Date.now()
//          Insert activities record: type "task_started", message: `Retry ${newRetryCount}/${maxRetries} for: ${task.title}`
//          Return { action: "retry" }
```

### 2.5 `convex/getPendingTasksForAgent.ts` — Agent task query

**Purpose:** Query tasks assigned to a specific agent that are claimable.

```typescript
// convex/getPendingTasksForAgent.ts
// Query — called by agent on heartbeat
// Args:
//   agentName: string
// Returns: Doc<"tasks">[]
//
// Logic:
//   1. Query tasks by status "pending" using by_status index
//   2. Filter: task.assignees.includes(agentName)
//   3. Filter: task.deadLettered !== true
//   4. Filter: task.approvalStatus !== "pending"   // do not claim tasks awaiting approval
//   5. Sort: by priority (urgent > high > medium > low > undefined), then by createdAt asc
//   6. Return array (may be empty)
//
// Priority sort order (numeric weight for sort):
//   urgent: 0, high: 1, medium: 2, low: 3, undefined: 4
```

### 2.6 `convex/requestApproval.ts` — Approval gate trigger

**Purpose:** Pauses a task and fires a WhatsApp-routed notification.

```typescript
// convex/requestApproval.ts
// Mutation — called by agent when encountering a gated action
// Args:
//   taskId: Id<"tasks">
//   agentName: string
//   actionDescription: string     // what the agent wants to do (≤500 chars)
//   approvalTier: "notify" | "gate"
//   timeoutMinutes: v.optional(v.number())  // for "notify" tier only; default 30
// Returns: { notificationId: Id<"notifications"> }
//
// Logic:
//   1. Load task
//   2. Patch task:
//        approvalTier: approvalTier
//        approvalStatus: "pending"
//        approvalRequestedAt: Date.now()
//        updatedAt: Date.now()
//        // do NOT change task.status — task remains in_progress but paused
//   3. Build notification content string:
//        "🔐 APPROVAL REQUIRED\n" +
//        `Task: ${task.title}\n` +
//        `Agent: ${agentName}\n` +
//        `Tier: ${approvalTier.toUpperCase()}\n` +
//        `Action: ${actionDescription}\n` +
//        (approvalTier === "notify" ? `Auto-proceeds in ${timeoutMinutes ?? 30} min if no response.\n` : "Task is BLOCKED until you respond.\n") +
//        `Reply APPROVE <taskId> or REJECT <taskId> via WhatsApp.`
//   4. Insert notifications record:
//        agentId: "dominic"         // special sentinel — Cestra's WhatsApp relay watches for this
//        type: "approval_request"
//        content: <built string>
//        relatedTaskId: taskId
//        delivered: false
//        createdAt: Date.now()
//   5. Patch task:
//        approvalNotificationId: <new notification _id as string>
//   6. Insert auditLog:
//        eventType: "approval_requested"
//        actorId: agentName
//        targetType: "task"
//        targetId: taskId
//        details: JSON.stringify({ tier: approvalTier, action: actionDescription })
//   7. Return { notificationId: <_id> }
```

### 2.7 `convex/respondToApproval.ts` — Approval response handler

**Purpose:** Records Dominic's approve/reject and unblocks or cancels the task.

```typescript
// convex/respondToApproval.ts
// Mutation — called by Cestra's WhatsApp handler when Dominic responds
// Args:
//   taskId: Id<"tasks">
//   decision: v.union(v.literal("approved"), v.literal("rejected"))
//   respondedBy: string           // "dominic"
//   rejectionReason: v.optional(v.string())
// Returns: null
//
// Logic:
//   1. Load task
//   2. If task.approvalStatus !== "pending": throw "No pending approval for this task"
//   3. Patch task:
//        approvalStatus: decision
//        approvalRespondedAt: Date.now()
//        updatedAt: Date.now()
//   4. If decision === "approved":
//        Insert notification for task.claimedBy agent:
//          agentId: task.claimedBy
//          type: "task_assigned"   // re-use existing type as "resume" signal
//          content: `APPROVED: You may proceed with task "${task.title}"`
//          relatedTaskId: taskId
//          delivered: false
//   5. If decision === "rejected":
//        Patch task:
//          status: "archived"
//          deadLetterReason: `Rejected by Dominic: ${rejectionReason ?? "no reason given"}`
//        Insert notification for task.claimedBy agent:
//          agentId: task.claimedBy
//          type: "system"
//          content: `REJECTED: Task "${task.title}" was rejected by Dominic. Reason: ${rejectionReason ?? "none"}`
//          relatedTaskId: taskId
//          delivered: false
//        Insert notification for cestra:
//          same content, agentId: "cestra"
//   6. Mark approvalNotificationId as delivered if present
//   7. Insert auditLog:
//        eventType: "approval_responded"
//        actorId: respondedBy
//        targetType: "task"
//        details: JSON.stringify({ decision, rejectionReason })
```

### 2.8 `convex/getDeadLetterQueue.ts` — Dead-letter inspection query

```typescript
// convex/getDeadLetterQueue.ts
// Query — used by Mission Control and Cestra
// Args: none
// Returns: Doc<"tasks">[] where deadLettered === true
//
// Logic:
//   Query tasks using by_dead_letter index where deadLettered === true
//   Order by deadLetteredAt desc
```

### 2.9 `convex/requeueDeadLetter.ts` — Requeue a dead-lettered task

```typescript
// convex/requeueDeadLetter.ts
// Mutation — called by Cestra or Dominic to reset a dead-lettered task
// Args:
//   taskId: Id<"tasks">
//   resetRetryCount: v.optional(v.boolean())  // default false
// Returns: null
//
// Logic:
//   1. Patch task:
//        deadLettered: false
//        deadLetteredAt: undefined
//        deadLetterReason: undefined
//        status: "pending"
//        claimedBy: undefined
//        retryCount: resetRetryCount ? 0 : task.retryCount
//        updatedAt: Date.now()
//   2. Insert auditLog: eventType: "task_requeued"
```

---

## 3. Task Pickup Loop — Agent-Side Logic

This section defines what each agent does during its heartbeat. This logic lives in each agent's OpenClaw system prompt / HEARTBEAT.md, not in Convex.

### 3.1 Heartbeat sequence (every 2h per agent)

```
HEARTBEAT EXECUTION SEQUENCE:
1. Call convex/heartbeat.ts  → update heartbeatAt, set status "active"
2. Call convex/getPendingTasksForAgent.ts (agentName = self)
3. If empty → no tasks. Check for unread notifications (approval responses, etc.)
4. If tasks present → pick the FIRST task only (highest priority, oldest)
5. Call convex/claimTask.ts(taskId, agentName)
   - If { success: false, reason: "already_claimed" } → skip, try next task in list
   - If { success: true } → proceed to execution
6. Execute the task (see Section 3.2)
7. On completion → call convex/completeTask.ts
8. On error → call convex/failTask.ts
9. Set agent status back to "idle" via heartbeat.ts call
```

**Critical rule:** An agent claims ONE task per heartbeat. No batching. This prevents context overload and keeps execution traceable.

**Claim atomicity:** The `claimTask` mutation is a Convex mutation (serialised transaction). Two agents calling it simultaneously for the same task will have one succeed and one receive `already_claimed`. This is the sole mechanism preventing double-pickup — no additional locking needed.

### 3.2 Task execution context

When an agent picks up a task, it receives:
- `task.title` — what to do
- `task.description` — full context
- `task.assignees` — who is involved (for handoff messages)
- `task.parentTaskId` — parent task if this is a sub-task

The agent executes using its own capabilities and tools as defined in its SOUL.md / TOOLS.md.

### 3.3 Mid-execution pause on approval gate

If during execution the agent determines it is about to perform a **Tier GATE** or **Tier NOTIFY** action (see Section 4), it must:

1. Call `convex/requestApproval.ts` before proceeding
2. For **NOTIFY** tier: pause execution, write a progress note, wait until next heartbeat then check notification for approval response before continuing
3. For **GATE** tier: halt execution entirely, write a progress note explaining the pause, do not continue until `convex/getNotifications.ts` returns an `approved` notification for this task

---

## 4. Human-in-the-Loop Approval Tiers

> **⚠️ REQUIRES DOMINIC SIGN-OFF BEFORE IMPLEMENTATION**

The following tier list classifies all agent action categories by required approval level. Koda must not implement the execution loop until Dominic has confirmed, modified, or rejected this list.

### Tier Definitions

| Tier | Name | Behaviour |
|------|------|-----------|
| `auto` | Fully autonomous | Agent proceeds without notification |
| `notify` | Notify & auto-proceed | WhatsApp notification sent; if no response within 30 min, agent proceeds |
| `gate` | Hard approval gate | Task pauses; WhatsApp notification sent; agent cannot proceed until Dominic replies APPROVE |
| `blocked` | Permanently blocked | Action category is never permitted; task is archived if attempted |

### Proposed Approval Tier List

#### TIER: `auto` (no approval needed)
- Reading files, analysing data, producing reports
- Writing to own workspace files (memory, notes, specs)
- Creating or updating documents in Convex (documents table)
- Posting messages/progress notes to Convex tasks
- Running web searches and fetching public URLs
- Sending messages within the agent squad (Convex messages table)
- Updating task status (pending → in_progress → complete)
- Logging heartbeats and activities
- Fetching credentials from the credentials table (read-only)

#### TIER: `notify` (WhatsApp notification; auto-proceeds in 30 min)
- Creating a new task in Convex on behalf of another agent
- Updating task assignees or priority
- Creating a new agent record in Convex
- Accessing credentials for a service not previously accessed in the current task context
- Spawning a sub-agent session
- Sending a message to an external human (not Dominic, not squad agents)
- Publishing content to any public channel (blog post, social post) that is NOT yet visible externally

#### TIER: `gate` (hard stop — must receive APPROVE)
- Sending any communication directly to a customer, lead, or external contact
- Publishing content publicly (website, social media, email list)
- Making any financial transaction or payment
- Creating, modifying, or deleting credentials/API keys
- Accessing any external API with write permissions (not read-only)
- Deleting or archiving tasks, documents, or records in Convex
- Modifying another agent's SOUL.md, AGENTS.md, or system files
- Making changes to infrastructure or deployment configuration
- Sending a WhatsApp or Telegram message to Dominic directly (outside system notifications)
- Creating a new cron job or modifying existing cron schedule

#### TIER: `blocked` (permanently forbidden — task archived if attempted)
- Exfiltrating credentials, private data, or personal information
- Modifying the OpenClaw gateway config to disable safety mechanisms
- Spawning agents outside the known DC81 squad
- Making purchases above £100 (any financial commitment)
- Self-replication or copying agent configs to new sessions without Cestra instruction

---

## 5. Inter-Agent Messaging & Task Handoffs

### 5.1 Message format convention

All agent-to-agent messages written to `convex/messages` must use a structured prefix so Mission Control can parse them:

```
[HANDOFF]    — task is being passed to another agent
[PROGRESS]   — status update during execution
[COMPLETE]   — task finished, result follows
[BLOCKED]    — agent is blocked waiting for input
[ESCALATE]   — escalation to Cestra required
[RESULT]     — structured result for downstream agent
[NOTE]       — informational, no action required
```

### 5.2 Task handoff flow (e.g. VEDA → ORIN)

When VEDA produces output intended for ORIN:

1. VEDA calls `convex/completeTask.ts` on its own task, writing a `resultSummary`
2. VEDA creates (or ensures existence of) a follow-on task in Convex assigned to ORIN:
   - `title`: descriptive
   - `description`: includes VEDA's result summary and explicit instructions
   - `assignees`: `["orin"]`
   - `status`: `"pending"`
   - `approvalTier`: `"notify"` (creating a task for another agent is Tier NOTIFY)
   - `parentTaskId`: VEDA's completed task ID
3. VEDA posts a `[HANDOFF]` message to ORIN's new task thread:
   ```
   [HANDOFF] VEDA → ORIN
   Context: <result summary>
   Request: <what ORIN needs to do>
   ```
4. ORIN picks up the task on its next heartbeat

### 5.3 ORIN → Cestra escalation flow

When ORIN reaches a GO/PIVOT/KILL recommendation:

1. ORIN completes its task with `resultSummary` = recommendation
2. ORIN posts an `[ESCALATE]` message to the task thread with full rationale
3. ORIN creates a new Cestra task:
   - `assignees`: `["cestra"]`
   - `title`: "Strategic Decision Required: <product name>"
   - `description`: full ORIN recommendation + evidence
   - `approvalTier`: `"auto"` (Cestra reading this is auto)
4. Cestra picks it up on next heartbeat, makes a strategic call, and routes accordingly

### 5.4 Mentions

The `messages.mentions` field should contain agent names that need to be notified. When a message is inserted with mentions, a corresponding `notifications` record should be inserted for each mentioned agent (type: `"mention"`).

> **New Convex function required:** `convex/sendMessage.ts` — inserts message + creates mention notifications atomically.

```typescript
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
```

---

## 6. Heartbeat Integration

### 6.1 No separate polling daemon

The 2h heartbeat cron (already configured in OpenClaw per ARCHITECTURE.md) is the sole trigger for task pickup. No additional polling daemon, webhook listener, or Convex scheduled function is needed.

### 6.2 Heartbeat → task pickup binding

Each agent's HEARTBEAT.md must be updated to include the task pickup sequence from Section 3.1. The heartbeat prompt fires the agent, the agent runs the pickup sequence as part of its heartbeat logic.

### 6.3 Staggered heartbeat timing

Per ARCHITECTURE.md, agents fire at staggered offsets:
- Cestra: :00
- VEDA: :02
- ORIN: :04
- Vision: :06
- Loki: :08

This natural stagger means two agents are unlikely to race on the same task. The atomic `claimTask` mutation is still the safety net.

### 6.4 Mid-cycle wake for approvals (future enhancement — not in scope for v1)

In v1, approval responses are only checked at the next heartbeat. In v2, Cestra's WhatsApp handler can call `cron wake now` after processing an approval response, so the agent wakes immediately. This is out of scope for Koda's current implementation.

---

## 7. WhatsApp Approval Notification Flow

### 7.1 Notification delivery path

Convex has no direct WhatsApp integration. The delivery path is:

```
Agent → convex/requestApproval.ts (inserts notification with agentId="dominic", type="approval_request")
       ↓
Cestra's heartbeat (every 2h, offset :00)
       ↓
Cestra queries getNotifications(agentId="dominic", unreadOnly=true)
       ↓
For each unread approval_request notification:
  Cestra sends WhatsApp message to Dominic via message tool
  Marks notification as delivered
       ↓
Dominic replies via WhatsApp: "APPROVE <taskId>" or "REJECT <taskId> <reason>"
       ↓
Cestra's WhatsApp message handler parses the reply
       ↓
Cestra calls convex/respondToApproval.ts(taskId, decision, reason)
```

### 7.2 WhatsApp message format (sent by Cestra)

```
🔐 APPROVAL REQUIRED — DC81 Mission Control

Task: <task.title>
Requested by: <agentName>
Tier: GATE / NOTIFY
Action: <actionDescription>

<GATE>: Task is paused. Reply to proceed.
<NOTIFY>: Auto-proceeds in 30 min if no response.

To approve: APPROVE <taskId>
To reject:  REJECT <taskId> <optional reason>
```

### 7.3 Cestra reply parsing

Cestra must implement a WhatsApp message handler that:
1. Detects messages starting with `APPROVE` or `REJECT` (case-insensitive)
2. Extracts taskId (second word)
3. Extracts optional rejection reason (remaining words)
4. Calls `convex/respondToApproval.ts`
5. Confirms back to Dominic via WhatsApp: "✅ Decision recorded for task <title>"

### 7.4 NOTIFY tier timeout

For Tier NOTIFY tasks, if the agent checks at its next heartbeat and:
- `task.approvalStatus === "pending"` AND
- `Date.now() - task.approvalRequestedAt > 30 * 60 * 1000` (30 minutes)

The agent auto-proceeds and writes a progress note: `[NOTE] Tier NOTIFY timeout reached. Auto-proceeding.`

---

## 8. Failure Handling

### 8.1 Retry logic summary

| Condition | Action |
|-----------|--------|
| Transient error (network, tool timeout) | Release claim, increment retry, requeue |
| Agent-determined terminal failure | Dead-letter immediately |
| retryCount > maxRetries (default 3) | Dead-letter |
| Dominic rejected the task | Archive (not dead-letter) |

### 8.2 Dead-letter queue

Dead-lettered tasks:
- Have `deadLettered: true`
- Have `status: "pending"` (so they appear in the normal queue but are filtered by `getPendingTasksForAgent`)
- Generate a `system` notification for Cestra
- Appear in the `getDeadLetterQueue` query for Mission Control display
- Can be requeued via `requeueDeadLetter.ts` by Cestra or Dominic

### 8.3 Stuck task detection (Cestra responsibility)

On every Cestra heartbeat:
1. Query all tasks with `status: "in_progress"`
2. For any task where `claimedAt < Date.now() - 4 * 60 * 60 * 1000` (stuck > 4 hours):
   - Post `[ESCALATE]` message to task thread
   - Create an escalation notification for Cestra itself
   - Optionally reset claim (`claimedBy: undefined`, `status: "pending"`) if deemed safe

> **Assumption:** 4-hour stuck threshold is appropriate given 2h heartbeat cycles. This leaves one full missed heartbeat before escalation fires. If a task is actively being worked, the agent will have written a progress note; Cestra can use the absence of recent progress notes as additional signal.

### 8.4 Escalation path

```
Task dead-lettered → Cestra notification
Cestra picks up on next heartbeat → evaluates
Options:
  a) Requeue with requeueDeadLetter (reset retries)
  b) Reassign to different agent (update task.assignees)
  c) Escalate to Dominic via WhatsApp
  d) Archive the task
```

---

## 9. Dependency Map

```
getPendingTasksForAgent  ← called by: all agents (heartbeat)
claimTask                ← called by: all agents (heartbeat, after getPendingTasks)
writeTaskProgress        ← called by: all agents (during execution)
completeTask             ← called by: all agents (on success)
failTask                 ← called by: all agents (on error)
requestApproval          ← called by: any agent encountering a gated action
respondToApproval        ← called by: Cestra (WhatsApp handler)
sendMessage              ← called by: all agents (handoffs, escalations)
getDeadLetterQueue       ← called by: Cestra (heartbeat), Mission Control (UI)
requeueDeadLetter        ← called by: Cestra (heartbeat), Dominic (via Cestra)

heartbeat.ts (existing)  ← called by: all agents (start of heartbeat, agent status update)
getNotifications (existing) ← called by: all agents (check for approval responses)
markNotificationDelivered (existing) ← called by: Cestra (after WhatsApp send)
```

---

## 10. HEARTBEAT.md Update Template

Each agent's `HEARTBEAT.md` (at `/root/.openclaw/agents/<name>/HEARTBEAT.md`) must be updated to include the following section. Koda should produce the update for all 6 agents (Cestra, VEDA, ORIN, Vision, Loki, Architect).

```markdown
## Task Pickup Sequence (run every heartbeat)

1. Call `convex/heartbeat.ts` with my agent name and status "active"
2. Call `convex/getPendingTasksForAgent.ts` with my agent name
3. If no tasks: check `convex/getNotifications.ts` for unread notifications, process any approval responses or mentions, then proceed to standard heartbeat
4. If tasks present:
   a. Take the first (highest priority / oldest) task
   b. Call `convex/claimTask.ts` — if already_claimed, try next task
   c. Execute the task using my capabilities
   d. On each meaningful progress step: call `convex/writeTaskProgress.ts`
   e. Before any GATE/NOTIFY action: call `convex/requestApproval.ts` and pause
   f. On success: call `convex/completeTask.ts`
   g. On error: call `convex/failTask.ts` with errorMessage and terminal flag
5. Call `convex/heartbeat.ts` again with status "idle"
```

---

## 11. Files to Create / Modify

| Action | File | Notes |
|--------|------|-------|
| Modify | `convex/schema.ts` | Add fields per Section 1.1, new notification types per 1.2, new indexes per 1.3 |
| Create | `convex/claimTask.ts` | Section 2.1 |
| Create | `convex/writeTaskProgress.ts` | Section 2.2 |
| Create | `convex/completeTask.ts` | Section 2.3 |
| Create | `convex/failTask.ts` | Section 2.4 |
| Create | `convex/getPendingTasksForAgent.ts` | Section 2.5 |
| Create | `convex/requestApproval.ts` | Section 2.6 |
| Create | `convex/respondToApproval.ts` | Section 2.7 |
| Create | `convex/getDeadLetterQueue.ts` | Section 2.8 |
| Create | `convex/requeueDeadLetter.ts` | Section 2.9 |
| Create | `convex/sendMessage.ts` | Section 5.4 |
| Modify | Each agent's `HEARTBEAT.md` | Section 10 |
| Deploy | `npx convex deploy` | After all schema and function changes |

---

## 12. Out of Scope (v1)

- Real-time Convex subscriptions / reactive push to agents (v2)
- Immediate wake-on-approval (v2 — see Section 6.4)
- Mission Control UI changes (separate spec)
- Parallel task execution per agent (v2 — single task per heartbeat in v1)
- Agent-to-agent direct messaging outside of Convex (no direct OpenClaw session calls)

---

## 13. Open Questions / Assumptions

| # | Assumption | Flag if wrong |
|---|-----------|--------------|
| A1 | All agents are OpenClaw agents accessible via their session keys in ARCHITECTURE.md | Flag if any agent is not yet provisioned |
| A2 | Cestra's WhatsApp is already linked and functional | Required for approval notifications |
| A3 | `npx convex deploy` is available in the workspace for Koda to use | Flag if deployment requires different tooling |
| A4 | The `tasks.assignees` field contains agent names (strings like "orin", "cestra") matching agent `name` field in the agents table | Flag if a different identifier is used |
| A5 | 4-hour stuck threshold is acceptable | Dominic to confirm or adjust |
| A6 | 30-minute NOTIFY auto-proceed timeout is acceptable | Dominic to confirm or adjust |
| A7 | Koda has write access to all agent workspace HEARTBEAT.md files | Required for Section 10 |

---

---GRAPH_UPDATE_START---
ENTITIES:
- TYPE: APIRoute | NAME: claimTask | file_path: convex/claimTask.ts | method: MUTATION | path: convex/claimTask | description: Atomically claims a pending task for an agent; prevents double-pickup
- TYPE: APIRoute | NAME: writeTaskProgress | file_path: convex/writeTaskProgress.ts | method: MUTATION | path: convex/writeTaskProgress | description: Agent writes mid-execution progress notes to task thread
- TYPE: APIRoute | NAME: completeTask | file_path: convex/completeTask.ts | method: MUTATION | path: convex/completeTask | description: Agent marks task complete and writes result summary
- TYPE: APIRoute | NAME: failTask | file_path: convex/failTask.ts | method: MUTATION | path: convex/failTask | description: Agent reports failure; applies retry or dead-letter logic
- TYPE: APIRoute | NAME: getPendingTasksForAgent | file_path: convex/getPendingTasksForAgent.ts | method: QUERY | path: convex/getPendingTasksForAgent | description: Returns claimable pending tasks for a given agent, sorted by priority
- TYPE: APIRoute | NAME: requestApproval | file_path: convex/requestApproval.ts | method: MUTATION | path: convex/requestApproval | description: Pauses task and fires WhatsApp-routed approval notification for Dominic
- TYPE: APIRoute | NAME: respondToApproval | file_path: convex/respondToApproval.ts | method: MUTATION | path: convex/respondToApproval | description: Records Dominic approve/reject decision and unblocks or archives the task
- TYPE: APIRoute | NAME: getDeadLetterQueue | file_path: convex/getDeadLetterQueue.ts | method: QUERY | path: convex/getDeadLetterQueue | description: Returns all dead-lettered tasks for Cestra and Mission Control
- TYPE: APIRoute | NAME: requeueDeadLetter | file_path: convex/requeueDeadLetter.ts | method: MUTATION | path: convex/requeueDeadLetter | description: Resets a dead-lettered task back to pending queue
- TYPE: APIRoute | NAME: sendMessage | file_path: convex/sendMessage.ts | method: MUTATION | path: convex/sendMessage | description: Inserts agent message to task thread and creates mention notifications atomically
- TYPE: DBTable | NAME: tasks | schema_name: public | description: Extended with claimedBy, claimedAt, retryCount, approvalTier, approvalStatus, resultSummary, deadLettered fields
- TYPE: Decision | NAME: HeartbeatAsPollingMechanism | rationale: No separate polling daemon needed; 2h heartbeat cron already exists per agent; avoids infrastructure complexity | alternatives_considered: Convex scheduled functions (added complexity), webhook push (no push mechanism to OpenClaw), continuous polling loop (resource waste) | status: active
- TYPE: Decision | NAME: SingleTaskPerHeartbeat | rationale: Prevents context overload, keeps execution traceable, reduces risk of partial failures mid-batch | alternatives_considered: Batch claim (risky with tool limitations), queue drain (unpredictable execution time) | status: active
- TYPE: Decision | NAME: ConvexMutationAtomicity | rationale: Convex mutations are serialised transactions; claimTask relies on this for double-pickup prevention without external locks | alternatives_considered: Redis locks (not in stack), optimistic concurrency (more complex) | status: active
- TYPE: Decision | NAME: ApprovalTierList | rationale: Four-tier system (auto/notify/gate/blocked) balances autonomy with safety; pending Dominic sign-off | alternatives_considered: Binary approve/deny (too coarse), per-agent tiers (overly complex for v1) | status: pending_approval
- TYPE: Decision | NAME: NotifyTier30MinTimeout | rationale: 30 minutes gives Dominic reasonable window to respond during working hours without blocking agents indefinitely | alternatives_considered: 15min (too short), 1h (too long for urgent tasks), no timeout (deadlock risk) | status: pending_approval

RELATIONSHIPS:
- SOURCE_TYPE: APIRoute | SOURCE: claimTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: tasks
- SOURCE_TYPE: APIRoute | SOURCE: claimTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: activities
- SOURCE_TYPE: APIRoute | SOURCE: claimTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: auditLog
- SOURCE_TYPE: APIRoute | SOURCE: completeTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: tasks
- SOURCE_TYPE: APIRoute | SOURCE: completeTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: activities
- SOURCE_TYPE: APIRoute | SOURCE: completeTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: notifications
- SOURCE_TYPE: APIRoute | SOURCE: failTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: tasks
- SOURCE_TYPE: APIRoute | SOURCE: failTask | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: notifications
- SOURCE_TYPE: APIRoute | SOURCE: getPendingTasksForAgent | REL: READS_FROM | TARGET_TYPE: DBTable | TARGET: tasks
- SOURCE_TYPE: APIRoute | SOURCE: requestApproval | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: notifications
- SOURCE_TYPE: APIRoute | SOURCE: requestApproval | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: tasks
- SOURCE_TYPE: APIRoute | SOURCE: requestApproval | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: auditLog
- SOURCE_TYPE: APIRoute | SOURCE: respondToApproval | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: tasks
- SOURCE_TYPE: APIRoute | SOURCE: respondToApproval | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: notifications
- SOURCE_TYPE: APIRoute | SOURCE: sendMessage | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: messages
- SOURCE_TYPE: APIRoute | SOURCE: sendMessage | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: notifications

DECISIONS:
- TITLE: HeartbeatAsPollingMechanism | RATIONALE: Reuses existing 2h cron schedule; no new infrastructure required | ALTERNATIVES: Convex scheduled functions, webhook push, continuous polling loop
- TITLE: SingleTaskPerHeartbeat | RATIONALE: Prevents context overload and keeps execution traceable; can be relaxed in v2 | ALTERNATIVES: Batch task claim, full queue drain per heartbeat
- TITLE: ConvexMutationAtomicity | RATIONALE: Convex serialises mutations — this is the sole locking mechanism needed | ALTERNATIVES: Redis locks, optimistic concurrency with version field
- TITLE: ApprovalTierList | RATIONALE: Four-tier system balances autonomy with safety; NOTIFY tier avoids blocking agents on low-risk actions | ALTERNATIVES: Binary approve/deny, per-agent tier matrices
- TITLE: DeadLetterToNotifyOnly | RATIONALE: Dead-lettered tasks notify Cestra not Dominic; Dominic only sees gate-tier decisions | ALTERNATIVES: All failures to Dominic (alert fatigue risk)
---GRAPH_UPDATE_END---
