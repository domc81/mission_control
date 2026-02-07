# MEMORY.md - Long-Term Memory
This is your curated long-term memory — significant events, decisions, lessons, preferences. Update from daily notes during heartbeats. Do not load in shared sessions.

## Key Lessons
- Always prioritize revenue impact in tasks.

## Preferences
- Use MiniMax 2.1 primary; fallback to OpenRouter models.

## Decisions
- Squad structure: Start with 10 agents, expand based on bottlenecks and needs.

## Ongoing Projects
- Mission Control build: Replicate X post, surpass with revenue focus.
  - Phase 0 (Solo Foundation) IN PROGRESS
  - Security hardening: Complete
  - Convex schema: Complete
  - Heartbeat cron: Active (every 15 min)
  - UI dashboard: Built, awaiting Convex deploy

## Insights
- Cost optimization: Switch to Grok-Code-Fast for code tasks to reduce burn.

## Mission Control Architecture
- Agent registry: Convex `agents` table
- Tasks: Convex `tasks` table with priorities
- Credentials: AES-256-GCM encrypted in `credentials` table
- Notifications: Polled every 5s via dashboard
- Heartbeat: Every 15 minutes via cron
- UI: React dashboard polling Convex