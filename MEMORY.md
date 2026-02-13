# MEMORY.md - Cestra's Long-Term Memory
Do not load in shared sessions. Update from daily notes during heartbeats.

### Mission Control / React Build
- This is Create React App (CRA) with Convex + Clerk integration
- Build command: `cd /root/.openclaw/workspace-cestra/ui && npm run build`
- ALWAYS run `npm run build` after any code change before claiming completion
- Clear cache with `rm -rf node_modules/.cache` if weird module errors occur
- Serve locally for testing: `cd build && python3 -m http.server 8080`

### NEVER AGAIN (BURNED ONCE)
- Claiming "COMPLETE" or "DONE" without actually running verification tests
- Writing "MISSION CONTROL REFACTOR COMPLETE" without running `npm run build`
- If you wrote code that affects the build pipeline, you MUST verify it compiles
- **NEVER modify heartbeat schedules** — they are controlled by openclaw.json, not by you
- **NEVER write documentation that contradicts actual system config** — always verify first

---

## Critical Operational Lessons

### Agent Creation (BURNED ONCE — NEVER AGAIN)
- Creating directories + SOUL.md does NOT register an agent with OpenClaw
- You MUST run `openclaw agents add <name> --workspace <path>` for each new agent
- You MUST run `openclaw config set agents.list.<name>.agentDir <path>` to set the agent dir
- You MUST run `openclaw agents set-identity --agent <name> --name "<Name>" --emoji "<emoji>"`
- You MUST register the agent in Convex via `registerAgent` mutation
- You MUST verify with `openclaw agents list` — if it's not in the list, it doesn't exist
- Each agent needs its OWN unique SOUL.md, IDENTITY.md, AGENTS.md, USER.md, TOOLS.md, MEMORY.md
- NEVER copy your own files to another agent unchanged — they are different entities

### OpenClaw Config (openclaw.json)
- The config uses strict Zod schema validation — unrecognised keys crash the gateway
- Field name `customPatterns` does not exist — the correct field is `redactPatterns`
- Field `mediaMaxMB` is wrong casing — correct is `mediaMaxMb`
- Always verify JSON syntax before saving (missing quotes break everything)
- After editing config: `openclaw gateway restart` then `openclaw doctor`
- `openclaw update` and `openclaw doctor` can resolve ${VAR} references and bake secrets into plaintext — always check config after running these

### WhatsApp
- Bot runs on dedicated SecondSIM Business number (NOT Dominic's personal number)
- `selfChatMode: false` (separate numbers, not self-chat)
- `dmPolicy: "allowlist"` with Dominic's number in `allowFrom`
- Tailscale provides stable IP — critical for session persistence
- Back up WhatsApp credentials before any OpenClaw update

---

## Architecture

### Mission Control Stack
- **Agent runtime:** OpenClaw on Hostinger KVM2 VPS (Ubuntu 22.04)
- **Database:** Convex (schema: agents, tasks, messages, credentials, notifications, documents, activities)
- **Credentials:** AES-256-GCM encrypted in Convex `credentials` table
- **Dashboard:** React UI polling Convex
- **Heartbeat:** Managed by OpenClaw gateway (2h for most agents, 4h for Fin)
- **Access:** Tailscale (zero public ports)
- **WhatsApp:** Dedicated Business number via SecondSIM eSIM

### Convex Schema
- `agents` — name, role, status, sessionKey, credentials_permitted
- `tasks` — title, description, status, assignees, priority
- `messages` — taskId, fromAgentId, content
- `credentials` — agentId, service, encryptedKey, permissions
- `notifications` — mentionedAgentId, content, delivered
- `documents` — title, content, type, taskId
- `activities` — type, agentId, message, timestamp

---

## Active Squad

| Agent | Role | Convex ID | Heartbeat |
|-------|------|-----------|-----------|
| Cestra | Squad Lead | j97cnp3g5vvsaxsdv528q279m180rs94 | Every 2h |
| VEDA | Product Intelligence Analyst | j9794m411dkxq7cxnxp3q64ddh80r3dd | Every 2h |
| ORIN | Customer Research Specialist | j97dfmkd4f97h02cv04681ygk180rfp0 | Every 2h |
| Vision | SEO Analyst | j97exdh8gemwt69xvmegzv2tzd80s8av | Every 2h |
| Loki | Content Architect | j97fxpw585n54kf728044fax2d80sk7z | Every 2h |
| Fin | Finance & Revenue Ops | j97eyw2qhn9hma9ecr7hxak6m980s270 | Every 4h |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Phase 0 | Use MiniMax M2.1 as primary model | Cost-effective with good quality |
| Phase 0 | Fallback chain: Gemini Flash → Kimi K2.5 → Grok Fast → GPT-5 | Redundancy |
| Phase 1 | Start with 3 agents, not 9 | Test infrastructure before scaling |
| Phase 2 | Documentation before scaling | Easier to maintain and onboard new agents |
| Phase 2 | AES-256-GCM for credential encryption | Non-negotiable security requirement |
| Phase 2 | Hardening before adding more agents | Stability > speed |

---

## Phase Progress

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Solo Foundation (Cestra only) | ✅ COMPLETE |
| Phase 1 | Spawn first agents (VEDA, ORIN) | ✅ COMPLETE |
| Phase 2 | Production Hardening | 🔄 IN PROGRESS |
| Phase 3 | Core Squad (9 total) | ⏳ PENDING |
| Phase 4+ | Scale continuously | ⏳ PENDING |

### Phase 2 Checklist
- [x] Security hardening complete
- [x] Convex schema updated with agent fields
- [x] Heartbeat schedule configured (2h/4h intervals)
- [x] UI dashboard built, Convex connected
- [x] Credential encryption (AES-256-GCM) active
- [x] Agent creation procedure documented
- [x] All agents properly registered via CLI (VEDA, ORIN, Vision, Loki, Fin)
- [x] Mission Control UI enhanced with Kanban, Documents, Filters
- [ ] 72-hour stability test
- [ ] Complex multi-agent task workflow test
- [ ] Notification daemon handling multiple agents

---

## Cost Tracking
- Primary model: MiniMax M2.1 via OpenRouter
- Track token burn per agent per task
- Abort tasks with negative ROI
- Consider Groq-Code-Fast for code-heavy tasks (cheaper)

---

## Files Created
- RUNBOOK.md — Operations guide
- TROUBLESHOOTING.md — Common issues and fixes
- ONBOARDING.md — Agent creation procedure
- ERROR_HANDLING.md — Resilience patterns
- VEDA/WORKFLOW.md — Competitor analysis pipeline
- ORIN/WORKFLOW.md — Customer research pipeline
