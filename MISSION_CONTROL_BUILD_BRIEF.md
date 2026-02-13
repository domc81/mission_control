# MISSION_CONTROL_BUILD_BRIEF.md

**FROM:** Dominic (Human Founder)
**TO:** Cestra (Squad Lead)
**MISSION:** Design and build Mission Control system with security-first architecture

---

## MISSION OVERVIEW

Build a complete multi-agent orchestration platform using:
- OpenClaw Gateway (AI agent runtime)
- Convex (serverless database)
- React (monitoring dashboard)

**Goal:** Create a scalable system where you autonomously spawn, manage, and coordinate many specialized AI agents (starting with 2-3, scaling to 10+, eventually dozens) with secure credential sharing.

**Reference:** https://x.com/pbteja1998/status/2017662163540971756 (Mission Control by Bhanu Teja P)

---

## YOUR AUTHORITY & CAPABILITIES

You have full access to:
- OpenClaw CLI (spawn agents, manage sessions, view logs)
- openclaw.json (read/write - you can configure everything)
- Convex database (design schema, write functions)
- VPS filesystem (create directories, manage workspaces)
- Credential vault (encrypt/store keys securely)

You can modify:
- OpenClaw configuration (logging, redaction, security policies)
- Convex schema and functions
- Agent SOUL.md and AGENTS.md files
- Cron jobs and heartbeat scheduling
- Memory file structures

---

## SECURITY CONSTRAINTS (NON-NEGOTIABLE)

### 1. Credential Management
- ✅ Store all API keys in Convex with AES-256-GCM encryption
- ✅ Each agent can ONLY access their authorized credentials
- ✅ Never log plaintext credentials
- ✅ Rotate credentials regularly
- ❌ NEVER store keys in openclaw.json, .env files, or filesystem as plaintext
- ❌ NEVER expose credentials in agent conversations or logs

### 2. Log Redaction
- Add custom redaction patterns to openclaw.json for:
  - API keys (sk-*, pk-*, auth_token)
  - Service names (ELEVENLABS, TWILIO, CONVEX, etc)
  - Bearer tokens
  - Environment variable patterns
- Redact at the logging level (don't rely on agents not exposing them)

### 3. File Permissions
- Set all ~/.openclaw directories to 700 (rwx------)
- Set all ~/.openclaw files to 600 (rw-------)
- Verify permissions are maintained across agent creation

### 4. Agent Isolation
- Agents can read their own credentials only
- Agents cannot access other agents' private files
- You (Cestra) have admin access to all credentials for delegation
- Implement per-agent access control in Convex RLS policies

### 5. Audit Trail
- Log all credential access (who, when, which service)
- Log all agent spawning events
- Log all permission changes
- Keep audit logs immutable in Convex

---

## ARCHITECTURE REQUIREMENTS

### 1. Agent System
- Cestra = Squad Lead (you) - coordinates everything
- Specialized agents with distinct SOULs (starting with core team, scaling as needed):
  - **Initial 9 agents (Phase 1-3):**
    - Shuri (Product Analyst)
    - Fury (Customer Researcher)
    - Vision (SEO Analyst)
    - Loki (Content Writer)
    - Quill (Social Media Manager)
    - Wanda (Designer)
    - Pepper (Email Marketing)
    - Friday (Developer)
    - Wong (Documentation)
  - **Future agents:** Design as needed (dozens possible - video generation, data analysis, specialized research, etc)

### 2. Convex Database
Design schema with tables:
- agents (name, role, status, sessionKey, credentials_permitted)
- tasks (title, description, status, assignees)
- messages (taskId, fromAgentId, content)
- credentials (agentId, service, encryptedKey, permissions)
- notifications (mentionedAgentId, content, delivered)
- documents (title, content, type, taskId)
- activities (type, agentId, message, timestamp)

Implement:
- Row-Level Security (RLS) for agent-specific access
- Encryption functions for credential storage
- Audit logging for all mutations

### 3. Heartbeat System
- Each agent wakes every 15 minutes (staggered by 2 min)
- Heartbeat checks:
  - Mission Control for @mentions
  - Assigned tasks
  - Activity feed for relevant discussions
  - Personal memory (WORKING.md)
- Agents execute work during heartbeat, then sleep
- Use OpenClaw crons to trigger heartbeats

### 4. Communication
- All agent communication via Convex (single source of truth)
- Task threads with @mention notifications
- Auto-subscription to threads when agents interact
- Notification daemon polls Convex every 2 seconds for undelivered notifications

### 5. Memory System
- Each agent has `/memory` directory with:
  - WORKING.md (current task, next steps)
  - YYYY-MM-DD.md (daily logs)
  - MEMORY.md (long-term learnings)
- Memory persists across heartbeats
- You update WORKING.md at start of each heartbeat

---

## YOUR BUILD WORKFLOW (PHASED APPROACH)

### PHASE 0: Solo Foundation (THIS PHASE - Cestra Only)
- [ ] Harden openclaw.json with logging redaction patterns
- [ ] Set up Convex schema with encryption strategy
- [ ] Write Convex credential management functions
- [ ] Create your own workspace (SOUL.md, AGENTS.md, HEARTBEAT.md)
- [ ] Set up memory files (WORKING.md, MEMORY.md)
- [ ] Register yourself in Convex as first agent
- [ ] Test heartbeat fires every 15 min
- [ ] Verify credentials encrypt/decrypt correctly
- [ ] Test task creation and self-assignment
- [ ] Build basic Mission Control UI (dashboard showing just you)
- [ ] Run for 24 hours, verify stability

**Gate:** Zero credential leaks in logs. Heartbeat 100% reliable. UI shows real-time updates.

---

### PHASE 1: Spawn 2 Agents (Next)
- [ ] Spawn Shuri (Product Analyst)
- [ ] Spawn Fury (Customer Researcher)
- [ ] Verify heartbeat staggering works (Cestra :00, Shuri :02, Fury :04)
- [ ] Test agent-to-agent communication via tasks
- [ ] Test @mentions between agents
- [ ] Verify credential isolation (each can only access their own)
- [ ] Run for 48 hours, log any issues

**Gate:** No credential bleeding. No agent can access another's creds. Communication works perfectly.

---

### PHASE 2: Expand to 5 Agents
- [ ] Spawn Vision, Loki, Quill
- [ ] Verify all 5 heartbeats staggered correctly
- [ ] Test complex task workflows (3+ agents on one task)
- [ ] Test notification daemon handling multiple agents
- [ ] Run for 72 hours

**Gate:** System stable under load. No race conditions. No lost messages.

---

### PHASE 3: Core Squad (9 Total)
- [ ] Spawn remaining 4 agents (Wanda, Pepper, Friday, Wong)
- [ ] Full integration testing
- [ ] Stress test: 50+ concurrent tasks
- [ ] Verify all security constraints at this scale

**Gate:** Core squad production ready.

---

### PHASE 4+: Expand Continuously
- [ ] Design new specialized agents as needed
- [ ] Scale heartbeat scheduling beyond 15 agents
- [ ] Optimize Convex queries for performance at scale (dozens of agents)
- [ ] Monitor system resource usage
- [ ] Add load balancing if needed

**Architecture must support unlimited agent spawning:** Think of Cestra as the orchestrator who can spawn agents indefinitely as the mission demands.

---

## TOOLS & RESOURCES YOU HAVE

**OpenClaw CLI:**
```bash
openclaw gateway restart              # Reload config
openclaw sessions list               # See active agents
openclaw cron add --name ...         # Schedule heartbeats
openclaw doctor --fix                # Fix configuration issues
```

**Convex CLI:**
```bash
npx convex dev                       # Local dev
npx convex deploy                    # Deploy schema + functions
npx convex run <function> <args>    # Test functions
```

**File Operations:**
```bash
cat, ls, mkdir, chmod, grep, find   # Standard Linux tools
git add/commit                       # Version control
```

**Access to Credentials:**
You can read (but never expose):
- Convex deployment URL
- Model provider API keys (already in auth-profiles.json)
- External service keys (ElevenLabs, Twilio, etc.)

---

## CONSTRAINTS & BOUNDARIES

### What You CAN Do:
✅ Spawn new agents (create workspaces, register in Convex)
✅ Write to openclaw.json and Convex schema
✅ Encrypt and store credentials securely
✅ Delegate tasks to agents
✅ Modify your own memory files
✅ Read agent logs and status
✅ Escalate blockers to Dominic

### What You CANNOT Do:
❌ Delete agents or tasks (only mark as archived)
❌ Expose credentials in any output
❌ Run agents 24/7 (use heartbeats only)
❌ Skip security practices for speed
❌ Access other agents' private workspaces

### When to Escalate to Dominic:
- Missing credentials or API keys
- Architectural decisions with trade-offs
- Security concerns or potential breaches
- System design changes
- Budget/cost implications
- External service integrations

---

## SUCCESS CRITERIA

Mission Control is successful when:

✅ Core foundation proven with Cestra alone (Phase 0)
✅ Multi-agent coordination works with 2-3 agents (Phase 1)
✅ System scales to 9+ agents without degradation (Phase 3)
✅ Each agent has unique SOUL and operates independently
✅ Heartbeat system fires reliably every 15 min (staggered, scaling as agents increase)
✅ Agents communicate via Convex task threads
✅ Credentials are encrypted and never exposed in logs
✅ @mentions trigger notifications correctly
✅ Memory system persists across restarts
✅ Dashboard shows real-time status for all agents
✅ Dominic can assign tasks via UI
✅ Agents complete tasks autonomously
✅ Zero credential leaks in logs or conversations
✅ Architecture supports spawning dozens of agents in the future

---

## IMMEDIATE NEXT STEP (Phase 0)

Start with just you (Cestra). Build:

1. Hardened openclaw.json
2. Convex schema + credential encryption
3. Your own SOUL.md, AGENTS.md, HEARTBEAT.md
4. Memory system
5. Basic Mission Control UI showing your status
6. One 24-hour test cycle

Report back with:
- All security hardening complete
- First heartbeat successful
- Credentials working
- UI deployed and showing your activity
- Any issues or blockers

**Ready? Start Phase 0. Build for scale.**
