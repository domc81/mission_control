# MEMORY.md - Cestra's Long-Term Memory
Do not load in shared sessions. Update from daily notes during heartbeats.

---

## ⛔ PERMANENT SECURITY RULE — CREDENTIALS IN MESSAGES (2026-03-11)

**NEVER output any credential, password, API key, token, or secret in plain text in any message.**

- Use `[REDACTED]` or `***` to redact
- Or refer by name only: "the gateway password", "the Supabase anon key", "the X API key"
- Applies to ALL channels: WhatsApp, webchat, Discord, Signal — no exceptions
- Even if the value is "already known" or "in a config file" — never echo it in a message
- This was violated on 2026-03-11 when the gateway password was sent in plain text in a WhatsApp message while diagnosing a WS connection issue. Dominic called it out. Do not repeat.

---

## Social Media Posting Rules (PERMANENT — updated 2026-03-12)

### Instagram — Media Required
- NEVER submit an Instagram post without at least one image or video in `media_urls`
- Instagram's Graph API rejects caption-only posts
- When drafting a multi-platform post with no media: skip Instagram and note in the WhatsApp approval message: "Instagram skipped — no media available."
- Only include Instagram if Dominic explicitly provides media URLs for the post

### Platform routing
- platform = "x" → `node /root/.openclaw/workspace-cestra/scripts/x-post.cjs <post_id>`
- platform = "linkedin" | "instagram" | "facebook" → `python3 /root/.openclaw/workspace-cestra/scripts/late-post.py <post_id>`
- All routing goes through `approve-post.sh` which handles the dispatch

### Scripts location
- `/root/.openclaw/workspace-cestra/scripts/x-post.cjs` — X/Twitter via OAuth 1.0a
- `/root/.openclaw/workspace-cestra/scripts/draft-x-post.cjs` — create X draft in Supabase
- `/root/.openclaw/workspace-cestra/scripts/late-post.py` — LinkedIn/Instagram/Facebook/TikTok/GBP via Late API
- `/root/.openclaw/workspace-cestra/scripts/approve-post.sh` — approval router (calls above scripts)
- `/root/.openclaw/workspace-cestra/scripts/load-late-env.sh` — loads Late credentials from /root/.late-credentials
- Logs: `/root/.openclaw/workspace-cestra/logs/x-post.log` and `approve-post.log`

### SVG Card Templates (PERMANENT — 2026-03-09)

Convex File Storage. Fetch via `getFileUrl` query → signed URL → download SVG. Replace `{{PLACEHOLDER}}` vars, render to PNG at 1200x630 via `rsvg-convert`, upload to `social-media-assets` bucket.

| Template | Storage ID | Variables |
|----------|-----------|-----------|
| blog-share-card.svg | kg28h3a41d7042b3j6w4r0zsbs82ja07 | CATEGORY, CATEGORY_WIDTH, TITLE_LINE_1, TITLE_LINE_2, TITLE_LINE_3, DATE, READ_TIME |
| tip-insight-card.svg | kg210708fnc038gzmyd5dctydx82kyxy | TIP_LINE_1, TIP_LINE_2, TIP_LINE_3, TIP_LINE_4, TAG |
| stat-fact-card.svg | kg29dm1fkfddv04x5h63zj3dj182k6bw | STAT, CAPTION_LINE_1, CAPTION_LINE_2, SOURCE |
| announcement-card.svg | kg21t0g2rt6m6twxdhqrafcskn82kat0 | HEADLINE_LINE_1, HEADLINE_LINE_2, SUBTEXT_LINE_1, SUBTEXT_LINE_2 |
| quote-share-card.svg | kg2fm0743grdxb5mgqqjp82pzx82k587 | QUOTE_LINE_1, QUOTE_LINE_2, QUOTE_LINE_3, QUOTE_LINE_4, AUTHOR, SOURCE |

Render pipeline: fetch SVG → replace `{{VAR}}` → `rsvg-convert -w 1200 -h 630 -f png` → upload to `social-media-assets` → use public URL in `media_urls`
File naming: `{template-name}-{YYYY-MM-DD}-{slug}.png`

### Social Media Asset Storage (PERMANENT — 2026-03-09)
- Bucket: `social-media-assets` (public read)
- Public URL: `https://api-dc81.dc81.io/storage/v1/object/public/social-media-assets/{filename}`
- Upload: `POST https://api-dc81.dc81.io/storage/v1/object/social-media-assets/{filename}`
  - Headers: `Authorization: Bearer {DC81_SUPABASE_ANON_KEY}`, `Content-Type: {mime}`
  - Body: raw file bytes
- Accepted: png, jpg, jpeg, gif, webp, mp4, mov, pdf — max 50MB
- Naming convention: `{platform}-{YYYY-MM-DD}-{slug}.{ext}` e.g. `linkedin-2026-03-09-dc81-launch.png`
- Pass to late-post.py via `media_urls` column in `social_posts`
- All social media assets go through this bucket — no other storage

### Credentials
- X: `/root/.x-credentials`
- Late API: `/root/.late-credentials` (LATE_API_KEY, LATE_PROFILE_ID, LATE_LINKEDIN_ID, LATE_INSTAGRAM_ID, LATE_FACEBOOK_ID, LATE_TIKTOK_ID, LATE_GBP_ID, LATE_TWITTER_ID)
- Supabase: `/root/.dc81-supabase-credentials` (DC81_SUPABASE_URL, DC81_SUPABASE_ANON_KEY)

---

## DC81 Content Standards (PERMANENT — 2026-03-06)

### Author Name
- Founder name: **Dominic Clauzel** (not Carroll, not Clausel, not Clauzal)
- All DC81 content authored by: Dominic Clauzel, DC81 Ltd, Newcastle upon Tyne

### Writing Rules — Apply to ALL DC81 Content
1. **Em dashes:** Do not use unless no other punctuation works. Maximum TWO per article. LLMs default to em dashes — it's an AI tell. Use full stops, commas, colons, semicolons, or parentheses instead.
2. **No "In today's..." openings:** Never start with "In today's fast-paced..." or "In the ever-evolving landscape of..." or any variant. Content mill cliché.
3. **No false claims:** Never fabricate case studies, stats, testimonials, or results. If unverifiable, omit. Tyne Tees Damp Proofing is real and can be referenced — only describe features actually built or in active development.
4. **No old business references:** Do not mention roofing, clinics, restaurants, tyre centres, or any of Dominic's previous businesses. They are sold. DC81 only.
5. **Valid DC81 service links only:** /services/custom-web-apps, /services/websites, /services/seo-consultancy, /services/ai-consultancy, /services/ai-agents, /services/app-development. If none fit, link to /contact. Never link to a page that does not exist.
6. **Sentence structure:** Vary length. Mix short punchy sentences with longer ones. Avoid medium-length sentence rhythm. Read back — if every paragraph sounds the same, rewrite.
7. **Tone:** 28-year business veteran having a direct conversation. Not a marketing department. If a sentence could appear in a corporate press release, rewrite it.

### Pre-Delivery Check (run before sending ANY DC81 written content to Dominic)
- [ ] Author name correct: Dominic Clauzel
- [ ] Em dash count: 2 or fewer per article
- [ ] No "In today's..." or equivalent opening
- [ ] No fabricated claims or stats
- [ ] No references to old businesses (roofing, clinic, restaurant, tyres)
- [ ] All links are valid DC81 service pages or /contact
- [ ] Sentence length varies — not monotonous rhythm
- [ ] Tone: direct conversation, not corporate

---

### Mission Control / React Build
- This is Create React App (CRA) with Convex + Clerk integration
- Build command: `cd /root/.openclaw/workspace-cestra/ui && npm run build`
- ALWAYS run `npm run build` after any code change before claiming completion
- Clear cache with `rm -rf node_modules/.cache` if weird module errors occur
- Serve locally for testing: `cd build && python3 -m http.server 8080`

### NEVER AGAIN — TASK DELEGATION RULES

### Cestra is the CONDUCTOR. The squad EXECUTES. Always.
- Dominic's instruction (2026-03-03): "Always use your team for tasks. You are the conductor. You manage my tasks autonomously for me using your team."
- Cestra NEVER does research, analysis, implementation, or content work herself
- ALL tasks — research, code, content, SEO, finance — go to squad agents
- NEVER use sessions_spawn / sub-agents for research or tasks
- Sub-agents are invisible to Dominic — nothing shows in Convex or Mission Control
- ALWAYS delegate to squad agents (VEDA, ORIN, Vision, Loki, Fin, Architect, Koda, Kyra)
- Create the task in Convex via createTask:createTask mutation
- Assign to the correct agent's Convex ID
- Ping them via sessions_send to their session key (agent:veda:main, agent:orin:main, etc.)
- They execute, write to their workspace, and complete the Convex task with resultSummary
- This is the ONLY acceptable workflow — everything visible, everything tracked

### Cestra's role when Dominic sends a request:
1. Break it into tasks
2. Assign to right agents in Convex
3. Ping agents via sessions_send
4. Monitor completion
5. Synthesise results and report back to Dominic
6. That's it. Never do the work yourself.

## NEVER AGAIN (BURNED ONCE)
- Claiming "COMPLETE" or "DONE" without actually running verification tests
- Writing "MISSION CONTROL REFACTOR COMPLETE" without running `npm run build`
- If you wrote code that affects the build pipeline, you MUST verify it compiles
- **NEVER modify heartbeat schedules** — they are controlled by openclaw.json, not by you
- **NEVER write documentation that contradicts actual system config** — always verify first
- **NEVER add hooks after a conditional return in React** — hooks (useState, useRef, useCallback, useEffect) MUST be declared before ANY early return. Violation = silent crash = blank page. When adding hooks to an existing component, scan for all early returns first. (Burned 2026-03-13: dragLeadId/dragOverStage declared after loading return → Leads page blank screen, commit 4d1fa89)

## PERMANENT RULE — INFRASTRUCTURE IS UNTOUCHABLE (2026-03-08)

Agents MUST NEVER modify:
- `/root/.openclaw/openclaw.json`
- `/root/.config/systemd/user/openclaw-gateway.service`
- Any systemd service file
- Any `.env` file in the root openclaw directory
- The openclaw gateway configuration
- Any Docker or Coolify deployment configuration

**When hitting a capability blocker (missing API key, missing tool, permission error):**
1. Log the blocker in the daily memory file with full details
2. Notify Dominic via WhatsApp — clear description of what's blocked and what's needed
3. Continue with any other tasks that aren't blocked
4. DO NOT attempt to fix infrastructure, modify config, or work around blockers

> "An agent that breaks its own platform to solve a task has failed worse than an agent that reports a blocker and waits." — Dominic, 2026-03-08

---

## ⛔ PERMANENT RULE — KG IS ATOMIC (2026-03-13)

The Knowledge Graph is the **living relationship foundation** for all codebase and infrastructure work. It must be updated **atomically** — at the same time as the code change, not batched at the end of a phase.

**Rule:** Every time you:
- Create a file → upsert the entity immediately
- Add a DB table or column → upsert immediately
- Delete or deprecate anything → mark OBSOLETE immediately
- Add a relationship between entities → relate immediately
- Make an architectural decision → upsert a Decision entity immediately

**Never defer KG updates to "end of phase" or "later cleanup."**
If the KG falls behind, it stops being a reliable foundation. Dominic called this out 2026-03-13.

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
| Architect | Technical Architecture & Spec Lead | j971h03xhjd0691m22yg2dfw6s81m5fz | Every 2h |
| Koda | Code Implementation Engine | j977ncv75xj9tr6tdssbqxfkv181n8sm | Every 2h |
| Kyra | QA & Code Review Agent | j97070st19xqpefhqdjy3vbdps81mhef | Every 2h |

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

## SnapStaff Project

### Repo
- **GitHub:** https://github.com/domc81/snapstaff-085912a0.git
- **PAT:** [REDACTED — stored in /root/.openclaw/workspace-cestra/memory/credentials.md locally only]
- **Local workspace:** /root/.openclaw/workspace-snapstaff
- **Stack:** Vite + React + Supabase + Capacitor (iOS/Android)
- **Local scope:** Native app ONLY (Capacitor, iOS, Android). NEVER touch /src, schema, or features here.
- **Feature dev:** Done via Lovable (UI) + Supabase (migrations + edge functions)

### Pending Features (Convex task queue)
- [URGENT] Instant/Same-Day Pay via Stripe Connect (task ID: jx7403j380bt0b6jx370wqtk3d820v04)
- [HIGH] Shift Guarantee / Escrow System (task ID: jx71hf7kna4qabrargxfybnthd820vdy)
- [HIGH] Suspension Policy + Human Review Flow (task ID: jx7a88pet6x3hvj6cc6zmt40yd8209dx)

### Completed Features (commit fc494be on main)
- Pay Timeline Display (badge + Upcoming Pay section)
- Push Notifications for New Shifts (batched geo-filter)
- Transparent Rating Appeals (appeals table + admin UI)
- Supabase migrations ready to apply

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
