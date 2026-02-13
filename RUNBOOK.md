# RUNBOOK: Agent Operations

**Last Updated:** 2026-02-08
**Audience:** Dominic (primary), future operators

---

## Quick Reference

### Agent Squad Status
| Agent | Role | ID | Heartbeat |
|-------|------|-----|-----------|
| Cestra | Squad Lead | j97cnp3g5vvsaxsdv528q279m180rs94 | :00 |
| VEDA | Product Intelligence | j9794m411dkxq7cxnxp3q64ddh80r3dd | :02 |
| ORIN | Customer Research | j97dfmkd4f97h02cv04681ygk180rfp0 | :04 |

### Key URLs
- **Convex Dashboard:** https://exciting-warbler-274.eu-west-1.convex.cloud
- **Workspace:** `/root/.openclaw/workspace-cestra/`

---

## Daily Operations

### Morning Health Check
```bash
# Check agent status
cd /root/.openclaw/workspace-cestra
npx convex run 'functions:getDashboard'

# Check for failed tasks
npx convex run 'functions:getActiveTasks'
```

### Weekly Tasks
- [ ] Review task completion rates
- [ ] Check audit log for anomalies
- [ ] Review agent performance
- [ ] Update priority backlog

---

## Task Management

### Creating a Task
```bash
cd /root/.openclaw/workspace-cestra
npx convex run 'functions:createTask' '{
  "title":"Task title",
  "description":"Detailed description",
  "assignees":["agent-id-1","agent-id-2"],
  "priority":"high|medium|low",
  "creatorId":"your-agent-id"
}'
```

### Task Lifecycle
```
pending → in_progress → review → completed|archived
```

### Priority Levels
- **urgent:** Must complete within 4 hours
- **high:** Must complete within 24 hours
- **medium:** Must complete within 72 hours
- **low:** No strict deadline

---

## Agent Management

### Check Agent Status
```bash
npx convex run 'functions:getAllAgents'
```

### View Agent Heartbeats
```bash
npx convex run 'functions:getDashboard'
# Look for "lastHeartbeat" timestamp
```

### Update Agent Status
```bash
npx convex run 'functions:updateStatus' '{
  "agentId":"agent-id",
  "status":"active|idle|busy|offline"
}'
```

---

## Inter-Agent Communication

### @Mention Another Agent
```bash
npx convex run 'functions:sendMessage' '{
  "taskId":"task-id",
  "authorId":"your-agent-id",
  "content":"Hey @AGENT_NAME, need your input on X",
  "mentions":["target-agent-id"]
}'
```

### Check Your Notifications
```bash
npx convex run 'functions:getNotifications' '{"agentId":"your-agent-id"}'
```

---

## Troubleshooting

### Agent Not Responding
1. Check `getDashboard` for heartbeat status
2. If heartbeat stale >30 min, restart agent session
3. Check audit log for errors
4. Review recent activity

### Task Stuck in "in_progress"
1. Check agent workload (other tasks?)
2. Send message to agent via task thread
3. Escalate to Cestra for reassignment

### Credential Access Failed
1. Verify agent ID in permissions
2. Check `auditLog` for denial reason
3. Re-store credential if needed

---

## Emergency Procedures

### Full Restart (If Needed)
```bash
# Restart OpenClaw gateway
openclaw gateway restart

# Verify all agents registered
npx convex run 'functions:getAllAgents'
```

### Credential Compromise (Theoretical)
1. If `.convex-deploy-key` exposed:
   - Revoke key in Convex dashboard
   - Generate new key
   - Update file
   - Run credential migration (Phase 2)
2. Check `auditLog` for unauthorized access

---

## Common Commands

| Task | Command |
|------|---------|
| List agents | `npx convex run 'functions:getAllAgents'` |
| List tasks | `npx convex run 'functions:getActiveTasks'` |
| Dashboard | `npx convex run 'functions:getDashboard'` |
| Create task | `npx convex run 'functions:createTask' '{...}'` |
| Send message | `npx convex run 'functions:sendMessage' '{...}'` |
| Notifications | `npx convex run 'functions:getNotifications' '{...}'` |
| Activity log | `npx convex run 'functions:getRecentActivities' '{...}'` |

---

## Contact

**Primary:** Cestra (agent j97cnp3g5vvsaxsdv528q279m180rs94)
**Escalation:** Manual intervention via webchat

---

*RUNBOOK - Keep this handy*
