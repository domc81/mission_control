# 72-Hour Stability Test

**Start Time:** 2026-02-11 12:09 UTC  
**End Time:** 2026-02-14 12:09 UTC  
**Status:** 🟢 IN PROGRESS

---

## Test Parameters

### Infrastructure Under Test
- **OpenClaw Gateway:** jarvis.taila10c67.ts.net
- **Convex Database:** exciting-warbler-274.eu-west-1.convex.cloud
- **WhatsApp Gateway:** +447346005755
- **Agent Count:** 6 (Cestra, VEDA, ORIN, Vision, Loki, Fin)
- **Heartbeat Interval:** 15 minutes (staggered :00, :02, :04, :06, :08, :10)

### Success Criteria

| Metric | Target | Tolerance |
|--------|--------|-----------|
| Heartbeat reliability | 100% | Allow 2 misses total |
| Heartbeat timing accuracy | ±30s | Per 15-min interval |
| Convex update latency | <5s | From heartbeat fire |
| Notification delivery | <30s | From creation to delivery |
| WhatsApp uptime | >99% | Max 5 min downtime |
| Memory file updates | Daily | One file per day |
| Session stability | No crashes | Zero session restarts |
| Cost tracking | Per agent | Token burn logged |

### What We're NOT Testing
- Multi-agent task workflows (separate test)
- Revenue pipeline end-to-end (separate test)
- UI deployment (post-stability)
- External API integrations (post-stability)

---

## Monitoring Schedule

### Automated (Every Heartbeat)
- Heartbeat timestamp logged to `memory/heartbeat-state.json`
- Convex `agents` table updated with status
- Activity feed logs heartbeat fire

### Manual Checkpoints (Every 8h)
- 20:00 UTC (Day 1, 2, 3)
- 04:00 UTC (Day 2, 3, 4)
- 12:00 UTC (Day 2, 3, 4)

**Manual Check Template:**
```bash
openclaw status
openclaw cron list
cat memory/heartbeat-state.json
```

---

## Checkpoint Log

### 2026-02-11 12:09 UTC - START
**Status:** 🟢 Test initiated  
**Action:** Updated WORKING.md, created test document  
**Next checkpoint:** 20:00 UTC (8h)

### 2026-02-11 15:05 UTC - Test Continuation Confirmed
**Status:** 🟢 ACTIVE (2h 56m elapsed)  
**Note:** Dominic adjusted heartbeat configuration directly (custom setup)  
**Instruction:** Do NOT modify heartbeat crons - observe only  
**Next checkpoint:** 20:00 UTC (4h 55m)

---

### 2026-02-11 20:00 UTC
_Pending_

---

### 2026-02-12 04:00 UTC
_Pending_

---

### 2026-02-12 12:00 UTC
_Pending_

---

### 2026-02-12 20:00 UTC
_Pending_

---

### 2026-02-13 04:00 UTC
_Pending_

---

### 2026-02-13 12:00 UTC
_Pending_

---

### 2026-02-13 20:00 UTC
_Pending_

---

### 2026-02-14 04:00 UTC
_Pending_

---

### 2026-02-14 12:09 UTC - END
_Pending final report_

---

## Known Issues (Pre-Test)

1. **Memory logs missing** — No 2026-02-10.md file (not critical)
2. **Security warnings** — Config file world-readable (deferred)
3. **Model drift** — Some sessions show different models than config (monitoring)

---

## Abort Conditions

Test will be aborted if:
- WhatsApp gateway offline >1 hour
- >10 consecutive missed heartbeats (any agent)
- Convex database unreachable >15 min
- OpenClaw gateway crashes
- Security incident detected

---

## Post-Test Deliverables

1. **Final Report** (`STABILITY_TEST_REPORT.md`)
2. **Heartbeat reliability chart** (% uptime per agent)
3. **Cost analysis** (token burn per agent)
4. **Failure analysis** (if any)
5. **Go/No-Go decision** for Phase 3 expansion

---

_Test started by Dominic at 2026-02-11 12:09 UTC_  
_No manual intervention unless critical failure_
