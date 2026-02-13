# PHASE 2: Production Hardening

**Date:** 2026-02-08
**Status:** PLANNED
**Objective:** Make the squad production-ready

---

## Goals

1. **Credential Security** - Move workspace creds to encrypted vault
2. **Heartbeat Reliability** - Get crons working
3. **Revenue Readiness** - First revenue-generating task
4. **Documentation** - Runbooks for Dominic

---

## Roadmap

### Step 1: Credential Migration (Priority: HIGH)

**Current State:** Plain-text files in workspace
```
/root/.openclaw/workspace-cestra/.convex-deploy-key
/root/.openclaw/workspace-cestra/.convex-auth-token
```

**Required:** CONVEX_VAULT_KEY environment variable

**Tasks:**
- [ ] Generate CONVEX_VAULT_KEY (32-byte hex)
- [ ] Configure in Convex deployment
- [ ] Test credential storage/retrieval
- [ ] Delete plain-text files
- [ ] Update agent workflows

**See:** `CREDENTIAL_MIGRATION.md`

---

### Step 2: Heartbeat System Fix

**Blocker:** WhatsApp gateway 401 error

**Tasks:**
- [ ] Get new WhatsApp Business API token
- [ ] Update gateway config
- [ ] Enable heartbeat crons for VEDA (:02)
- [ ] Enable heartbeat crons for ORIN (:04)
- [ ] Verify 15-min heartbeat cycle

---

### Step 3: Revenue Task Prototype

**Goal:** First revenue-generating workflow

**Idea:** Product intelligence pipeline
```
1. VEDA analyzes market opportunity
2. ORIN validates with customer research  
3. Cestra decides go/no-go
```

**Tasks:**
- [ ] VEDA: Build competitor monitoring (RSS → Convex)
- [ ] ORIN: Build survey template for validation
- [ ] Cestra: Define go/no-go decision criteria
- [ ] End-to-end test

---

### Step 4: Documentation & Runbooks

**Deliverables:**
- `RUNBOOK.md` - How to add new agents
- `TROUBLESHOOTING.md` - Common issues
- `ONBOARDING.md` - Agent creation process

---

## Quick Wins (While Waiting)

| Task | Description | Status |
|------|-------------|--------|
| Test task workflow | Create → Assign → Complete | ✅ Done |
| Dashboard verification | Verify real-time updates | ✅ Done |
| Activity audit | Check Convex audit log | ✅ Done |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Agents registered | 3/3 ✅ |
| Inter-agent comms working | 100% ✅ |
| Credential encryption | Pending |
| Heartbeat uptime | >99% (pending) |
| Revenue workflow | Prototyped |

---

*Phase 2 - Production Hardening*
