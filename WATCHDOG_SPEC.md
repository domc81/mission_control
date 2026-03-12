# DC81 Squad Watchdog — Technical Specification
**Status:** Awaiting review  
**Author:** Cestra  
**Date:** 2026-03-12  
**Version:** 1.0

---

## Overview

A Linux cron job running `/root/scripts/watchdog.py` every 5 minutes. It queries Convex for task state, pings agents via the OpenClaw gateway HTTP API when tasks are unworked, and sends WhatsApp alerts to Dominic when escalation thresholds are breached. No Convex schema changes are required for the core watchdog. Optional schema additions for `stale`/`escalated` statuses are treated as a separate Phase 2.

---

## Component 1: Watchdog Script

### File Location
```
/root/scripts/watchdog.py
```

### Dependencies
- Python 3.10+ (already on server)
- `requests` library (`pip install requests` — already available system-wide)
- No other dependencies

### Environment
The script reads two values from environment variables set in the crontab:
```
GATEWAY_PASSWORD   — OpenClaw gateway auth password
CONVEX_URL         — https://exciting-warbler-274.eu-west-1.convex.cloud
```
Neither value is hardcoded in the script.

---

### 1.1 Agent Registry

The script contains a static registry mapping agent names to their Convex IDs and OpenClaw session keys. This is static configuration, not dynamic lookup, to avoid dependency on Convex being reachable just to know who to ping.

```
AGENTS = [
    { "name": "cestra",    "convex_id": "j97cnp3g5vvsaxsdv528q279m180rs94", "session_key": "agent:cestra:main" },
    { "name": "veda",      "convex_id": "j9794m411dkxq7cxnxp3q64ddh80r3dd", "session_key": "agent:veda:main" },
    { "name": "orin",      "convex_id": "j97dfmkd4f97h02cv04681ygk180rfp0", "session_key": "agent:orin:main" },
    { "name": "vision",    "convex_id": "j97exdh8gemwt69xvmegzv2tzd80s8av", "session_key": "agent:vision:main" },
    { "name": "loki",      "convex_id": "j97fxpw585n54kf728044fax2d80sk7z", "session_key": "agent:loki:main" },
    { "name": "fin",       "convex_id": "j97eyw2qhn9hma9ecr7hxak6m980s270", "session_key": "agent:fin:main" },
    { "name": "architect", "convex_id": "j971h03xhjd0691m22yg2dfw6s81m5fz", "session_key": "agent:architect:main" },
    { "name": "koda",      "convex_id": "j977ncv75xj9tr6tdssbqxfkv181n8sm", "session_key": "agent:koda:main" },
    { "name": "kyra",      "convex_id": "j97070st19xqpefhqdjy3vbdps81mhef", "session_key": "agent:kyra:main" },
]
```

**Note on `getPendingTasksForAgent`:** This Convex query filters by `agentName` against the `assignees` array. However, `assignees` stores Convex IDs (e.g. `j977ncv75xj9tr6tdssbqxfkv181n8sm`), not name strings. The watchdog must therefore pass the `convex_id` as the `agentName` argument, not the human-readable name.

---

### 1.2 Convex API Calls

**Base URL:** `https://exciting-warbler-274.eu-west-1.convex.cloud`  
**Authentication:** None required for public queries (Convex public API). The existing functions have no auth checks — they are public mutations/queries.  
**Method:** POST to `/api/query` or `/api/mutation`  
**Content-Type:** `application/json`

#### Call 1: Get all task statuses
Used to find pending and in_progress tasks across all agents.

```
POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/query
{
  "path": "getTasksByStatus",
  "args": {}
}
```

**Response shape:**
```json
{
  "status": "success",
  "value": {
    "pending": [
      {
        "_id": "<convex task id>",
        "title": "<string>",
        "status": "pending",
        "assignees": ["<convex agent id>", ...],
        "createdAt": 1741234567890,
        "updatedAt": 1741234567890,
        "claimedBy": null,
        "claimedAt": null,
        "deadLettered": false,
        "priority": "high"
      }
    ],
    "in_progress": [
      {
        "_id": "<convex task id>",
        "title": "<string>",
        "status": "in_progress",
        "assignees": ["<convex agent id>"],
        "createdAt": 1741234567890,
        "updatedAt": 1741234567890,
        "claimedBy": "koda",
        "claimedAt": 1741234567890
      }
    ],
    "completed": [...]
  }
}
```

**Fields used by the watchdog:**
- `_id` — task identifier for log messages
- `title` — included in ping/alert messages
- `assignees` — matched against AGENTS registry to identify which agent to ping
- `createdAt` — used to calculate age of pending tasks
- `updatedAt` — used to calculate staleness of in_progress tasks
- `claimedBy` — used to identify which agent owns an in_progress task
- `deadLettered` — skip dead-lettered tasks (they get separate handling)
- `priority` — included in alert messages

#### Call 2: Get dead letter queue
```
POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/query
{
  "path": "getDeadLetterQueue:getDeadLetterQueue",
  "args": {}
}
```

**Response shape:**
```json
{
  "status": "success",
  "value": [
    {
      "_id": "<id>",
      "title": "<string>",
      "deadLetterReason": "<string>",
      "deadLetteredAt": 1741234567890,
      "retryCount": 4
    }
  ]
}
```

The watchdog alerts Dominic if this array is non-empty and the item has not already been reported (see state file, Section 1.6).

---

### 1.3 OpenClaw Gateway API Calls

**Base URL:** `http://127.0.0.1:18789`  
**Authentication:** Bearer token using the gateway password  
**Header:** `Authorization: Bearer <GATEWAY_PASSWORD>`  
**Content-Type:** `application/json`

#### Call A: Ping an agent (inject task reminder)

Used when a pending task has been unworked for > 10 minutes.

```
POST http://127.0.0.1:18789/tools/invoke
{
  "tool": "sessions_send",
  "args": {
    "sessionKey": "agent:<agentId>:main",
    "message": "WATCHDOG: You have pending tasks. Check Convex and claim your next task now.\n\nPending task: <title> (priority: <priority>, age: <N> min)\nTask ID: <_id>",
    "timeoutSeconds": 10
  }
}
```

**Expected response (success):**
```json
{
  "ok": true,
  "result": {
    "details": {
      "runId": "<uuid>",
      "status": "timeout",
      "sessionKey": "agent:koda:main"
    }
  }
}
```

Note: `"status": "timeout"` is normal and expected — it means the agent didn't reply within `timeoutSeconds`. The message was delivered. The watchdog treats both `"timeout"` and any `"status"` value as successful delivery as long as `"ok": true`.

#### Call B: Send WhatsApp alert to Dominic

Used for escalation alerts (in_progress stale > 2h, pending > 4h, dead letter queue).

```
POST http://127.0.0.1:18789/tools/invoke
{
  "tool": "message",
  "args": {
    "action": "send",
    "to": "+447377541121",
    "message": "<alert text>"
  }
}
```

**Expected response (success):**
```json
{
  "ok": true,
  "result": {
    "details": {
      "channel": "whatsapp",
      "to": "+447377541121",
      "result": {
        "messageId": "<id>"
      }
    }
  }
}
```

---

### 1.4 Decision Logic

All time comparisons use `time.time() * 1000` (milliseconds) to match Convex timestamps.

#### Pending Tasks — Agent Ping

For each task with `status == "pending"` and `deadLettered != true`:

1. Calculate `age_ms = now_ms - task["createdAt"]`
2. Identify assigned agents by matching `task["assignees"]` against the AGENTS registry by `convex_id`
3. Apply thresholds:

| Age | Action |
|-----|--------|
| < 10 min | No action (task just created, give agent time to pick it up on next heartbeat) |
| 10 min – 4 hours | Ping assigned agent(s) via `sessions_send` with task details. Rate-limited: ping each (task, agent) pair at most once per 30 minutes (see state file). |
| > 4 hours | WhatsApp alert to Dominic. Message format: `⚠️ STUCK TASK (pending {N}h)\n"{title}"\nAssigned to: {agent_names}\nTask ID: {_id}`. Rate-limited: alert at most once per 2 hours per task. |

#### In-Progress Tasks — Staleness Detection

Staleness is measured by `updatedAt`, not `claimedAt`. `updatedAt` advances whenever the agent calls `writeTaskProgress` or `completeTask`. If `updatedAt` has not moved, the agent has stopped working without completing.

For each task with `status == "in_progress"`:

1. Calculate `stale_ms = now_ms - task["updatedAt"]`
2. Identify the owning agent via `task["claimedBy"]` (name string) matched against AGENTS registry by `name`

| Staleness | Action |
|-----------|--------|
| < 2 hours | No action |
| 2h – 8h | Ping the claimedBy agent via `sessions_send`: `WATCHDOG: Task "{title}" has had no progress update for {N}h. Update progress via writeTaskProgress or complete/fail it.` Rate-limited: once per 2 hours per task. |
| > 8h | WhatsApp alert to Dominic: `🔴 STUCK IN-PROGRESS (no update {N}h)\n"{title}"\nClaimed by: {agent}\nTask ID: {_id}`. Rate-limited: once per 4 hours per task. |

#### Dead Letter Queue

For each item in the dead letter queue not already reported:

- Immediately send WhatsApp to Dominic: `💀 DEAD LETTER: "{title}"\nFailed {retryCount}x. Reason: {deadLetterReason[:200]}\nTask ID: {_id}`
- Mark as reported in state file (never report the same task twice)

---

### 1.5 Logging

**Log file:** `/root/logs/watchdog.log`  
**Format:** Plain text, one line per event, ISO timestamp prefix  
**Rotation:** The log file is not auto-rotated by the script. Use `logrotate` or let it grow — it is append-only.

Log lines written:
```
2026-03-12T10:05:01 [START] Watchdog run started
2026-03-12T10:05:01 [CONVEX] Fetched tasks: 12 pending, 4 in_progress
2026-03-12T10:05:02 [PING] koda ← "Audit Engine Crawl4AI" (pending 47min)
2026-03-12T10:05:02 [PING_OK] sessions_send → agent:koda:main status=timeout
2026-03-12T10:05:03 [ALERT] WhatsApp → Dominic: "Audit Engine Scoring" stuck in_progress 9h
2026-03-12T10:05:03 [ALERT_OK] messageId=3EB0EE734B...
2026-03-12T10:05:03 [SKIP] "Brand Guard GTM" — already alerted 1h ago
2026-03-12T10:05:03 [END] Run complete. 2 pings, 1 alert, 0 errors.
2026-03-12T10:05:03 [ERROR] Convex unreachable: ConnectionError — skipping run
```

**Dry-run mode:** When `DRY_RUN=1` is set in the environment, all `[PING]` and `[ALERT]` actions are logged but no actual API calls are made. The log prefix changes to `[DRY_PING]` and `[DRY_ALERT]`.

---

### 1.6 State File

**Path:** `/root/scripts/watchdog-state.json`

The state file prevents repeat pings/alerts within cooldown windows. It persists across cron runs.

**Schema:**
```json
{
  "last_ping": {
    "<task_id>:<agent_name>": 1741234567890
  },
  "last_alert": {
    "<task_id>": 1741234567890
  },
  "reported_dead_letters": [
    "<task_id>",
    "<task_id>"
  ]
}
```

**Cooldown windows:**
| Event type | Cooldown |
|-----------|---------|
| Agent ping (pending task) | 30 minutes per (task, agent) pair |
| Dominic alert (pending > 4h) | 2 hours per task |
| Dominic alert (in_progress stale > 8h) | 4 hours per task |
| Dead letter report | Never repeat (persisted forever) |

**State file corruption handling:** If the state file cannot be parsed, the watchdog logs `[WARN] State file corrupt — resetting` and starts with an empty state. This may result in one duplicate alert cycle, which is acceptable.

---

### 1.7 Error Handling

| Failure | Behaviour |
|---------|-----------|
| Convex unreachable (ConnectionError, timeout) | Log `[ERROR]`, skip entire run, exit 0 (do not alert Dominic — transient) |
| Convex returns `{"status": "error"}` | Log `[ERROR]` with errorMessage, skip affected query, continue with others |
| Gateway unreachable (port 18789 not responding) | Log `[ERROR]`, skip all pings and alerts for this run, exit 0 |
| Gateway returns `{"ok": false}` | Log `[ERROR]` with error detail, continue to next action |
| WhatsApp send fails | Log `[ERROR]`, do NOT update state file (so it retries next run) |
| State file write fails | Log `[WARN]`, continue (next run will re-alert, minor issue) |
| Script crashes unexpectedly | Cron captures stderr to log file. No silent failure. |

The watchdog never crashes loudly to cron's stderr unless it's an unrecoverable startup error (missing env vars). All operational errors are caught and logged.

---

### 1.8 Linux Cron Entry

Add to root's crontab (`crontab -e`):

```
*/5 * * * * GATEWAY_PASSWORD="#SpartacuS81!" CONVEX_URL="https://exciting-warbler-274.eu-west-1.convex.cloud" DRY_RUN=0 /usr/bin/python3 /root/scripts/watchdog.py >> /root/logs/watchdog.log 2>&1
```

Notes:
- `>> /root/logs/watchdog.log 2>&1` — appends both stdout and stderr to the log
- `/root/logs/` directory must exist before the first run
- Run as root (same user that owns the gateway process)
- During testing, set `DRY_RUN=1` in the cron line

---

## Component 2: HEARTBEAT.md Template

### 2.1 Mandatory Task Lifecycle Section

The following block must be present in every agent's HEARTBEAT.md. It is the same across all agents except for the two agent-specific values noted below.

```markdown
## On Each Heartbeat: Task Lifecycle

### Step 1: Check for pending tasks
```
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/query \
  -H "Content-Type: application/json" \
  -d '{"path":"getPendingTasksForAgent:getPendingTasksForAgent","args":{"agentName":"<CONVEX_ID>"}}'
```

If tasks returned:
- Take the FIRST task (highest priority, already sorted by API)
- Claim it immediately:
```
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
  -H "Content-Type: application/json" \
  -d '{"path":"claimTask:claimTask","args":{"taskId":"<TASK_ID>","agentName":"<AGENT_NAME>"}}'
```
- Execute the task using your tools
- Write progress updates every meaningful step:
```
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
  -H "Content-Type: application/json" \
  -d '{"path":"writeTaskProgress:writeTaskProgress","args":{"taskId":"<TASK_ID>","agentName":"<AGENT_NAME>","progressNote":"<NOTE>"}}'
```
- On success, call completeTask:
```
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
  -H "Content-Type: application/json" \
  -d '{"path":"completeTask:completeTask","args":{"taskId":"<TASK_ID>","agentName":"<AGENT_NAME>","resultSummary":"<SUMMARY>"}}'
```
- On failure or blocker, call failTask — DO NOT just stop working:
```
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
  -H "Content-Type: application/json" \
  -d '{"path":"failTask:failTask","args":{"taskId":"<TASK_ID>","agentName":"<AGENT_NAME>","errorMessage":"<DESCRIPTION OF BLOCKER>"}}'
```

**CRITICAL: Never stop working on a task without calling completeTask or failTask. If you are blocked, failTask with a clear errorMessage. "I couldn't find the credentials" is a valid failTask reason. Silence is not.**

### Step 2: Update heartbeat status
```
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
  -H "Content-Type: application/json" \
  -d '{"path":"heartbeat:heartbeat","args":{"agentId":"<CONVEX_ID>","status":"idle"}}'
```

### Step 3: If no tasks — reply HEARTBEAT_OK
```

### 2.2 Agent-Specific Values

Two values must be substituted per agent:

| Placeholder | What it is | Where to find it |
|-------------|-----------|-----------------|
| `<CONVEX_ID>` | The agent's Convex document ID (used in `agentName` arg for `getPendingTasksForAgent`, `claimTask`, `writeTaskProgress`, `completeTask`, `failTask`, and `heartbeat`) | See registry below |
| `<AGENT_NAME>` | Same as `<CONVEX_ID>` — both use the Convex ID, not the human name | See registry below |

**Note:** This is counterintuitive. Both `agentName` and the `heartbeat` `agentId` use the Convex ID string, not the human-readable name. This is because `assignees` in tasks stores Convex IDs. The `claimedBy` field does use the human name (it is set by the mutation itself from the task's existing `claimedBy` value or the passed `agentName`) — but for all query/mutation args, pass the Convex ID.

**Wait — correction on claimedBy:** `claimedBy` in the task is set to the `agentName` arg passed to `claimTask`. Currently tasks show `claimedBy: "koda"` (human name). The existing agents were passing human names to `claimTask`. To avoid breaking the staleness detection in the watchdog (which matches `claimedBy` against the human name), agents should continue passing their human-readable name to `claimTask` specifically, while passing their Convex ID to `getPendingTasksForAgent`.

**Revised substitution table:**

| Placeholder | `getPendingTasksForAgent` `agentName` | `claimTask` `agentName` | `writeTaskProgress` / `completeTask` / `failTask` `agentName` | `heartbeat` `agentId` |
|-------------|--------------------------------------|------------------------|---------------------------------------------------------------|----------------------|
| Use value | Convex ID | Human name (lowercase) | Human name (lowercase) | Convex ID |

**Complete registry:**

| Agent | Human name (for claimTask etc.) | Convex ID (for getPending + heartbeat) |
|-------|--------------------------------|---------------------------------------|
| cestra | cestra | j97cnp3g5vvsaxsdv528q279m180rs94 |
| veda | veda | j9794m411dkxq7cxnxp3q64ddh80r3dd |
| orin | orin | j97dfmkd4f97h02cv04681ygk180rfp0 |
| vision | vision | j97exdh8gemwt69xvmegzv2tzd80s8av |
| loki | loki | j97fxpw585n54kf728044fax2d80sk7z |
| fin | fin | j97eyw2qhn9hma9ecr7hxak6m980s270 |
| architect | architect | j971h03xhjd0691m22yg2dfw6s81m5fz |
| koda | koda | j977ncv75xj9tr6tdssbqxfkv181n8sm |
| kyra | kyra | j97070st19xqpefhqdjy3vbdps81mhef |

---

### 2.3 Complete Example: Koda's HEARTBEAT.md (after update)

```markdown
# HEARTBEAT.md - Koda

## Direct Messages from Cestra
If a message arrives from Cestra (not a heartbeat prompt), READ it and ACT on it immediately.
Do not reply HEARTBEAT_OK to direct task instructions.

## On Each Heartbeat: Task Lifecycle

### Step 1: Check for pending tasks
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/query \
  -H "Content-Type: application/json" \
  -d '{"path":"getPendingTasksForAgent:getPendingTasksForAgent","args":{"agentName":"j977ncv75xj9tr6tdssbqxfkv181n8sm"}}'

If tasks returned:
- Take the FIRST task
- Claim it:
  curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
    -H "Content-Type: application/json" \
    -d '{"path":"claimTask:claimTask","args":{"taskId":"<TASK_ID>","agentName":"koda"}}'
- Execute fully. Do NOT mark complete based on "builds successfully" alone.
- Write progress updates at each major step:
  curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
    -H "Content-Type: application/json" \
    -d '{"path":"writeTaskProgress:writeTaskProgress","args":{"taskId":"<TASK_ID>","agentName":"koda","progressNote":"<NOTE>"}}'
- On success:
  curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
    -H "Content-Type: application/json" \
    -d '{"path":"completeTask:completeTask","args":{"taskId":"<TASK_ID>","agentName":"koda","resultSummary":"<PASTE ACTUAL FUNCTION BODIES OR KEY OUTPUTS>"}}'
- On any blocker or failure — call failTask, do not go silent:
  curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
    -H "Content-Type: application/json" \
    -d '{"path":"failTask:failTask","args":{"taskId":"<TASK_ID>","agentName":"koda","errorMessage":"<WHAT BLOCKED YOU>"}}'

CRITICAL: Never stop working on a task without calling completeTask or failTask.
Silence means the task stays in_progress forever and triggers a Dominic alert.

### Step 2: Update heartbeat status
curl -s -X POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation \
  -H "Content-Type: application/json" \
  -d '{"path":"heartbeat:heartbeat","args":{"agentId":"j977ncv75xj9tr6tdssbqxfkv181n8sm","status":"idle"}}'

### Step 3: If no tasks — reply HEARTBEAT_OK

## Koda-Specific Rules
- Run `npm run build` after EVERY code change before claiming completion
- Paste actual function bodies in resultSummary — "implemented X" is not accepted
- Read TOOLS.md for Coolify API token, GitHub PAT, and all service credentials
- Verify functional behaviour, not just compilation success

## Convex Base URL
https://exciting-warbler-274.eu-west-1.convex.cloud

## My Convex ID: j977ncv75xj9tr6tdssbqxfkv181n8sm
## My human name (for claimTask): koda
```

### 2.4 What Changes Per File

1. The `agentName` in `getPendingTasksForAgent` — use the **Convex ID** from the registry
2. The `agentName` in `claimTask`, `writeTaskProgress`, `completeTask`, `failTask` — use the **lowercase human name**
3. The `agentId` in `heartbeat` — use the **Convex ID**
4. The agent-specific rules section (quality bars, credential locations, role-specific guidance)
5. The header/title line

Everything else is identical across all 9 files.

---

## Component 3: Convex Schema Changes

### 3.1 Phase 1 (Required for watchdog) — None

The watchdog does not require any schema changes. It reads existing fields (`createdAt`, `updatedAt`, `status`, `claimedBy`, `assignees`, `deadLettered`) and calls existing mutations.

### 3.2 Phase 2 (Optional — adds explicit stale/escalated tracking)

These changes are not required for the watchdog to function but add explicit state tracking visible in Mission Control.

#### Changes to `schema.ts`

In the `tasks` table definition, update the `status` union:

```typescript
// BEFORE:
status: v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("review"),
  v.literal("completed"),
  v.literal("archived")
),

// AFTER:
status: v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("review"),
  v.literal("completed"),
  v.literal("archived"),
  v.literal("stale"),       // in_progress, no update for 2+ hours
  v.literal("escalated")    // Dominic has been notified
),
```

Add two new fields to the `tasks` table:

```typescript
staledAt: v.optional(v.number()),       // timestamp when status set to stale
escalatedAt: v.optional(v.number()),    // timestamp when Dominic was alerted
```

#### New mutation: `markTaskStale.ts`

Called by the watchdog (Phase 2 only) when transitioning `in_progress` → `stale`:
- Args: `taskId: Id<"tasks">`, `reason: string`
- Sets `status: "stale"`, `staledAt: Date.now()`, logs to `activities`

#### New mutation: `markTaskEscalated.ts`

Called by the watchdog (Phase 2 only) after sending a Dominic alert:
- Args: `taskId: Id<"tasks">`, `alertedAt: number`
- Sets `status: "escalated"`, `escalatedAt: alertedAt`, logs to `auditLog`

#### Migration approach

Convex schema changes are applied by editing `schema.ts` and running:
```bash
cd /root/.openclaw/workspace-cestra && npx convex deploy
```

This is non-destructive. Convex applies schema changes as migrations automatically — existing rows without the new fields are unaffected (fields are `v.optional`). The new status literals are additive. No data migration required.

#### Impact on existing queries and UI

- `getTasksByStatus` returns tasks grouped by status. Adding `stale` and `escalated` means the UI will receive two new keys in the response object. The Mission Control Kanban board renders columns dynamically — new columns for `stale` and `escalated` will appear automatically **if** the UI's column config includes them. If not, they'll be ignored by the UI but visible in raw data.
- `updateTaskStatus.ts` must be updated to accept the two new literals in its validator — otherwise dashboard status-change controls will reject the new values.
- `getPendingTasksForAgent` is unaffected — it filters by `status == "pending"` only.
- `completeTask` and `failTask` are unaffected.

**Recommendation:** Implement Phase 2 schema changes as a separate PR after the watchdog is confirmed stable, to keep the blast radius small.

---

## Component 4: Deployment and Testing

### 4.1 Testing Plan — Pre-Live

**Step 1: Dry run (DRY_RUN=1)**

Set `DRY_RUN=1` in the cron entry. The script runs on the 5-minute schedule, queries Convex, evaluates thresholds, and logs `[DRY_PING]` / `[DRY_ALERT]` entries — but makes zero API calls to the gateway or WhatsApp.

Verify via log:
```bash
tail -50 /root/logs/watchdog.log
```

Expected output for a task that is pending 47 minutes:
```
2026-03-12T10:05:01 [START] Watchdog run started
2026-03-12T10:05:01 [CONVEX] Fetched tasks: 12 pending, 4 in_progress
2026-03-12T10:05:02 [DRY_PING] koda ← "Audit Engine Crawl4AI" (pending 47min) — DRY RUN, no call made
2026-03-12T10:05:02 [END] Run complete. 0 pings, 0 alerts (DRY RUN).
```

Run in dry mode for at least 2 full cron cycles (10 minutes) to verify threshold logic.

**Step 2: Live ping test (DRY_RUN=0, alerting disabled)**

Temporarily set WhatsApp alert threshold to 999 hours so no alerts fire. Enable actual `sessions_send` pings only. Manually verify in Koda's session that a WATCHDOG message arrives. Check the log confirms `[PING_OK]`.

**Step 3: Live alert test (single controlled alert)**

Create a test task in Convex assigned to koda, manually set its `createdAt` to 5 hours ago (via a one-off Convex mutation call), set `DRY_RUN=0` with normal thresholds. Confirm WhatsApp alert arrives on your phone. Confirm it doesn't repeat within the 2-hour cooldown window. Delete the test task.

**Step 4: Full live deployment**

Remove `DRY_RUN=1` from the cron. Normal operation begins.

### 4.2 HEARTBEAT.md Verification

**Success criteria per agent:**

After updating HEARTBEAT.md for an agent, success means the agent's next heartbeat run:
1. Calls `getPendingTasksForAgent` (visible in the agent's session history — the curl command should appear in the model's tool output or the model should report the result)
2. If tasks exist: calls `claimTask` and begins work
3. Calls `writeTaskProgress` at least once during execution
4. Calls `completeTask` or `failTask` at the end — never goes silent

**How to verify:**

Check the Convex `activities` table after a heartbeat runs. A claimed task creates an activity with `type: "task_started"`. Progress updates create additional activities. Completion creates a `task_completed` activity. If the only activity after a heartbeat is the `heartbeat` type (from `heartbeat.ts`), the agent ran but did no task work.

Alternatively, check Mission Control — task status should move from `pending` to `in_progress` within 2 hours of creation (when the agent's next heartbeat fires).

**Baseline for existing broken agents (ORIN, Loki):**

Before updating their HEARTBEAT.md, their 3 stuck `in_progress` tasks (Brand Guard, Blog Post 4, UK SMB Research) need to be assessed — they are 128–143 hours stale. These should be manually reset to `pending` or `archived` via the updateTaskStatus mutation before the HEARTBEAT.md update, so the agent doesn't pick up a 6-day-old task and try to continue it from scratch.

### 4.3 Rollback Plan

**Watchdog rollback:**

The watchdog is a standalone script with no dependencies on OpenClaw config or Convex schema. To disable it immediately:
```bash
crontab -e
# Comment out or delete the watchdog line
```
No gateway restart required. No state is written to Convex by the watchdog (Phase 1). The state file at `/root/scripts/watchdog-state.json` can be deleted to reset cooldown tracking.

**HEARTBEAT.md rollback:**

Each HEARTBEAT.md is a plain file in the agent workspace. Roll back by restoring the previous content. The old content is in git (workspace commits). No gateway restart required — takes effect on next heartbeat fire.

**Schema rollback (Phase 2 only):**

Reverting `schema.ts` and running `npx convex deploy` removes the new status literals. Any tasks in `stale` or `escalated` status would fail validation on read. Before rolling back the schema, run a one-off Convex mutation to reset any tasks with those statuses to `in_progress` or `pending`. This is why Phase 2 is deferred until Phase 1 is confirmed stable.

---

## Implementation Order

1. Update HEARTBEAT.md for all 9 agents (no code, no deploy, immediate effect)
2. Resolve the 3 stuck in_progress tasks (manual Convex mutation to reset/archive)
3. Build and test watchdog script in dry-run mode
4. Live ping test (sessions_send only)
5. Live alert test (controlled)
6. Full live deployment (cron active, DRY_RUN=0)
7. Monitor for 48 hours before considering Phase 2 schema changes

---

*End of spec. Ready for review.*
