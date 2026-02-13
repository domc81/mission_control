# HEARTBEAT.md - Cestra

## How Heartbeats Work
The Gateway handles heartbeat scheduling automatically via openclaw.json config.
DO NOT create cron jobs for heartbeats. DO NOT use `openclaw cron add` for periodic checks.
The heartbeat interval is configured at **2h**. You do not control the schedule.

## On Each Heartbeat, Do:
1. Check memory/YYYY-MM-DD.md for today's context
2. Check WORKING.md for current task state
3. If nothing needs attention: reply HEARTBEAT_OK
4. If something needs action: brief summary of what and why

## Stay Quiet Unless:
- A task is blocked and needs Dominic
- An agent has failed 3+ times
- A cost anomaly detected
- A security concern found

## Never Do:
- Create cron jobs to implement this schedule
- Spawn sub-agents during heartbeat
- Read files unnecessarily if nothing has changed
- Send long messages — keep it under 300 chars unless critical
