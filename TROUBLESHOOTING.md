# TROUBLESHOOTING: Common Issues

**Last Updated:** 2026-02-08

---

## Issue: Agent Not Registering

### Symptoms
- Agent workspace created but not in `getAllAgents`
- Registration function returns error

### Diagnosis
```bash
# Check if agent was registered
npx convex run 'functions:getAllAgents'

# Look for agent name in list
```

### Solutions

#### 1. Schema Not Deployed
```
Error: "Could not find function"
```
**Fix:** Deploy schema
```bash
cd /root/.openclaw/workspace-cestra
npx convex deploy
```

#### 2. Wrong Function Path
```
Error: "functions.registerAgent is not a valid path"
```
**Fix:** Use colon syntax
```bash
npx convex run 'functions:registerAgent' '{...}'
```

#### 3. Missing CONVEX_DEPLOY_KEY
```
Error: "401 Unauthorized"
```
**Fix:** Set environment
```bash
export CONVEX_DEPLOY_KEY="prod:deployment-id|eyJ..."
npx convex deploy
```

---

## Issue: Heartbeat Not Working

### Symptoms
- Agent status shows "offline"
- No heartbeat updates in dashboard

### Solutions

#### 1. Gateway Down
```
System: "WhatsApp gateway disconnected"
```
**Fix:** Update WhatsApp API token
- Get new token from Meta Business
- Update OpenClaw config
- Restart gateway

#### 2. Cron Not Configured
```
No heartbeat at scheduled time
```
**Fix:** Add cron manually
```bash
openclaw cron add --schedule "*/15 * * * *" --agent agent-name
```

#### 3. Agent Session Dead
```
Heartbeat stale >30 min
```
**Fix:** Restart agent session
```bash
openclaw sessions kill <session-id>
# Agent will restart on next cron
```

---

## Issue: Task Not Delivered

### Symptoms
- Task created but assignee not notified
- No "task_assigned" notification in getNotifications

### Diagnosis
```bash
# Check task status
npx convex run 'functions:getActiveTasks'

# Check notifications for assignee
npx convex run 'functions:getNotifications' '{"agentId":"assignee-id"}'
```

### Solutions

#### 1. Wrong Assignee ID
```
Task created but wrong agent ID
```
**Fix:** Update task assignees
```bash
npx convex run 'functions:updateTaskStatus' '{
  "taskId":"task-id",
  "status":"archived",
  "agentId":"your-agent-id"
}'
# Create new task with correct IDs
```

#### 2. Notification Polling Delayed
```
Recent task not showing
```
**Fix:** Wait 5-10 seconds, notifications poll every 5s

---

## Issue: Credential Access Denied

### Symptoms
```
Error: "Access denied" when retrieving credential
```

### Diagnosis
```bash
# Check audit log
npx convex run 'functions:getRecentActivities'
# Look for "credential_access_denied"
```

### Solutions

#### 1. Wrong Agent ID
```
Credential owned by different agent
```
**Fix:** Only the owning agent can access. Re-store credential.

#### 2. Encryption Key Missing
```
Error: "CONVEX_VAULT_KEY not set"
```
**Fix:** Set environment variable (requires Convex support)

---

## Issue: Message Not Delivered

### Symptoms
- @mention sent but no notification
- Message not visible to mentioned agent

### Solutions

#### 1. Wrong Mention ID
```
Agent ID in mentions array is wrong
```
**Fix:** Verify agent IDs from `getAllAgents`

#### 2. Task Not Visible
```
Message sent to wrong task
```
**Fix:** Messages are task-scoped. Send to correct task ID.

---

## Issue: Convex CLI Not Working

### Symptoms
```
Error: "No CONVEX_DEPLOYMENT set"
```

### Solutions

#### 1. Create env file
```bash
cd /root/.openclaw/workspace-cestra
echo "CONVEX_DEPLOY_KEY=prod:..." > .env.local
npx convex run ...
```

#### 2. Check deployment URL
```bash
cat convex.json
# Should have correct deployment name
```

---

## Issue: Gateway Timeout

### Symptoms
```
Error: "Gateway timeout after 60000ms"
```

### Solutions

#### 1. Reduce Load
- Fewer concurrent operations
- Smaller data transfers

#### 2. Check Network
```bash
ping exciting-warbler-274.eu-west-1.convex.cloud
```

#### 3. Retry Later
- Gateway may be temporarily overloaded
- Try again in 5 minutes

---

## Emergency Contacts

| Issue | Severity | Action |
|-------|----------|--------|
| All agents down | 🔴 Critical | Restart gateway, check Convex status |
| Credentials exposed | 🔴 Critical | Rotate keys immediately |
| Task system broken | 🟠 High | Check Convex dashboard |
| Single agent stuck | 🟡 Medium | Restart agent session |
| Documentation wrong | 🟢 Low | Update RUNBOOK |

---

## Diagnostic Commands

```bash
# Full system check
npx convex run 'functions:getDashboard'

# Agent list
npx convex run 'functions:getAllAgents'

# Active tasks
npx convex run 'functions:getActiveTasks'

# Recent activity
npx convex run 'functions:getRecentActivities' '{"limit":20}'

# Notifications for agent
npx convex run 'functions:getNotifications' '{"agentId":"..."}'
```

---

*TROUBLESHOOTING - Keep this for quick fixes*
