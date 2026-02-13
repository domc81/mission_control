# ONBOARDING: Creating New Agents

**Last Updated:** 2026-02-08
**Purpose:** Step-by-step guide to add agents to the squad

---

## Prerequisites

- Access to workspace: `/root/.openclaw/workspace-cestra/`
- Convex CLI: `npx convex`
- OpenClaw CLI: `openclaw`
- Agent design ready (SOUL.md, AGENTS.md)

---

## Step 1: Design the Agent

### Create Agent SOUL.md
```markdown
# SOUL: [AGENT_NAME]

I am [AGENT_NAME] — [One-line description].

## Core Identity
**What I do:** [2-3 sentences]
**How I think:** [Key traits]
**Expertise:** [List of skills]

## Operating Principles
1. [Principle 1]
2. [Principle 2]
3. [Principle 3]

## Boundaries
- I don't [action]
- I don't [action]

## Interactions
- **With Cestra:** [How they communicate]
- **With Other Agents:** [Collaboration style]

## What I Deliver
- [Deliverable 1]
- [Deliverable 2]
```

### Create Agent AGENTS.md
```markdown
# AGENTS.md - [AGENT_NAME]'s Workspace

## Identity
**Name:** [AGENT_NAME]
**Role:** [Role title]
**Leader:** Cestra (squad commander)

## Session Start
1. Read `SOUL.md`
2. Read `PHASE1.md` (or current phase)
3. Read `memory/YYYY-MM-DD.md`
4. Check Convex for tasks

## Core Responsibilities
- [Responsibility 1]
- [Responsibility 2]

## Workflow
### Daily
1. Check Convex notifications
2. Review assigned tasks
3. Execute work
4. Heartbeat

## Communication Protocol
### With Cestra
- Format: [Brief/detailed?]
- Frequency: [Async/daily/weekly]

### With Other Agents
- Use Convex tasks
- Use @mentions for urgency

## Heartbeat
- Schedule: Every 15 min at :XX
- Offset: [XX]

## Boundaries
- DO NOT [action]
- DO NOT [action]
```

---

## Step 2: Create Workspace

```bash
# Create workspace directory
mkdir -p /root/.openclaw/workspace-[agent-name]/memory

# Copy template files
cp /root/.openclaw/workspace-cestra/SOUL.md /root/.openclaw/workspace-[agent-name]/
cp /root/.openclaw/workspace-cestra/AGENTS.md /root/.openclaw/workspace-[agent-name]/
cp /root/.openclaw/workspace-cestra/USER.md /root/.openclaw/workspace-[agent-name]/
cp /root/.openclaw/workspace-cestra/HEARTBEAT.md /root/.openclaw/workspace-[agent-name]/

# Customize each file (see Step 1)
```

---

## Step 3: Create HEARTBEAT.md

```markdown
# HEARTBEAT.md - [AGENT_NAME]'s Heartbeat Protocol

## Heartbeat Schedule
- **Frequency:** Every 15 minutes
- **Offset:** :XX past the hour (unique, e.g., :02, :04)

## Heartbeat Checkpoints
| Checkpoint | Status |
|------------|--------|
| Read SOUL.md | ⏳ |
| Read AGENTS.md | ⏳ |
| Poll Convex notifications | ⏳ |
| Review assigned tasks | ⏳ |
| Update heartbeat | ⏳ |

## Success Criteria
- ✅ Heartbeat fires every 15 min at :XX
- ✅ Convex updates within 5 seconds
```

---

## Step 4: Update Convex Schema

Add agent fields to `/root/.openclaw/workspace-cestra/convex/schema.ts`:

```typescript
agents: defineTable({
  name: v.string(),
  role: v.string(),
  capabilities: v.optional(v.array(v.string())),  // ADD THIS
  workspace: v.optional(v.string()),               // ADD THIS
  heartbeatOffset: v.optional(v.number()),        // ADD THIS
  status: v.optional(v.union(...)),
  sessionKey: v.optional(v.string()),
  heartbeatAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
```

---

## Step 5: Deploy Schema

```bash
cd /root/.openclaw/workspace-cestra
export CONVEX_DEPLOY_KEY="prod:..."
npx convex deploy
```

---

## Step 6: Register Agent in Convex

```bash
cd /root/.openclaw/workspace-cestra
npx convex run 'functions:registerAgent' '{
  "name":"AGENT_NAME",
  "role":"Role Title",
  "capabilities":["skill1","skill2","skill3"],
  "workspace":"/root/.openclaw/workspace-[agent-name]",
  "heartbeatOffset":XX
}'
```

**Output:** Returns agent ID (save this!)

---

## Step 7: Save Agent ID

```bash
# Save to workspace
echo "AGENT_ID" > /root/.openclaw/workspace-[agent-name]/.agent-id

# Update WORKING.md in main workspace
# Add agent to squad table
```

---

## Step 8: Set Up Heartbeat Cron

```bash
openclaw cron add \
  --schedule "*/15 * * * *" \
  --agent [agent-name] \
  --offset XX
```

---

## Step 9: Update Documentation

1. **MEMORY.md:** Add to "Active Squad" table
2. **WORKING.md:** Add to current phase checklist
3. **AGENTS.md:** Add inter-agent communication patterns

---

## Step 10: Test the Agent

### Test 1: Registration
```bash
npx convex run 'functions:getAllAgents'
# Verify agent appears
```

### Test 2: Task Assignment
```bash
npx convex run 'functions:createTask' '{
  "title":"Test task",
  "assignees":["AGENT_ID"],
  "creatorId":"CESTRA_ID"
}'
```

### Test 3: Notification
```bash
npx convex run 'functions:getNotifications' '{"agentId":"AGENT_ID"}'
# Should show task_assigned
```

### Test 4: @Mention
```bash
npx convex run 'functions:sendMessage' '{
  "taskId":"TASK_ID",
  "authorId":"CESTRA_ID",
  "content":"Hey @AGENT_NAME, test",
  "mentions":["AGENT_ID"]
}'
```

### Test 5: Response
```bash
npx convex run 'functions:getNotifications' '{"agentId":"AGENT_ID"}'
# Should show mention notification
```

---

## Step 11: Announce to Squad

```markdown
**New Agent Alert**

Welcome [AGENT_NAME] to the squad!

- **Role:** [Title]
- **Expertise:** [Skills]
- **Heartbeat:** :XX
- **Workspace:** /root/.openclaw/workspace-[agent-name]/

@VEDA @ORIN @CESTRA
```

---

## Checklist Summary

- [ ] SOUL.md created with distinct personality
- [ ] AGENTS.md with operating manual
- [ ] USER.md for human context
- [ ] HEARTBEAT.md with schedule
- [ ] Workspace directory created
- [ ] Memory directory structure
- [ ] Convex schema updated
- [ ] Schema deployed
- [ ] Agent registered
- [ ] Agent ID saved
- [ ] Heartbeat cron configured
- [ ] Documentation updated
- [ ] All tests passed

---

## Common Issues

| Issue | Fix |
|-------|-----|
| "Function not found" | Deploy schema first |
| "Invalid agent ID" | Use ID from registration |
| "Mention not delivered" | Verify agent ID in mentions array |
| "Heartbeat not firing" | Check cron configuration |

---

*ONBOARDING - Follow these steps to grow the squad*
