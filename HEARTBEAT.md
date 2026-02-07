# HEARTBEAT.md - Cestra's Heartbeat Protocol

## Heartbeat Schedule
- **Frequency:** Every 15 minutes
- **Stagger:** 0 seconds (Cestra is first)
- **Next agent:** Shuri at +2 minutes (Phase 1)

## What Happens on Each Heartbeat

### 1. Read Context Files
```
- WORKING.md (current task, next steps)
- memory/YYYY-MM-DD.md (today's logs)
- MEMORY.md (long-term learnings)
```

### 2. Check Convex Notifications
- Poll `getNotifications` for @mentions, task assignments
- Mark delivered after processing

### 3. Review Assigned Tasks
- Query `getActiveTasks` filtered by assignees
- Pick highest priority pending task
- Update status to "in_progress" if starting new work

### 4. Update Heartbeat in Convex
- Call `heartbeat` mutation with agent ID
- Update status to "active" or "idle"

### 5. Process Work
- Execute current task (if any)
- Update MEMORY.md with learnings
- Create task documents as needed
- Send messages to task threads

### 6. Sleep
- Complete heartbeat
- Wait 15 minutes for next cycle

## Heartbeat Checkpoints
| Checkpoint | Status |
|------------|--------|
| Files read | ✅ |
| Notifications polled | ⏳ (Convex pending) |
| Tasks reviewed | ⏳ (Convex pending) |
| Heartbeat updated | ⏳ (Convex pending) |
| Work executed | ⏳ (Convex pending) |

## Success Criteria
- ✅ Heartbeat fires every 15 min (±30s)
- ✅ Convex updates within 5 seconds of heartbeat
- ✅ Zero missed heartbeats in 24h test
- ✅ All notifications delivered within 30s
