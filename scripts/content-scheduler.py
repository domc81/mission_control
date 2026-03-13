#!/usr/bin/env python3
"""
content-scheduler.py — DC81 Autonomous Content Scheduler
Runs on cron. Decides what to create today, then calls content-pipeline.py.

Schedule (controlled by cron):
  - Mon/Wed/Fri 08:00: LinkedIn + X + Instagram + Facebook (card rendered)
  - Tue/Thu 08:00:     LinkedIn + Facebook (text-friendly days)
  - Sat 09:00:         Blog post draft

Instagram is always included — every post gets a card rendered (tip/stat/quote/announcement).
Instagram is automatically dropped from the run only if card rendering fails.
Facebook runs every day alongside at least one other platform.

Does NOT run if:
  - Already ran today (state file)
  - Too many pending_approval posts exist (backlog protection, limit=8)
  - Too many draft blog posts exist (limit=3)

Topics rotate from topic bank. ORIN adds new topics when bank runs low.
"""

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WORKSPACE      = "/root/.openclaw/workspace-cestra"
STATE_FILE     = f"{WORKSPACE}/logs/content-scheduler-state.json"
LOG_FILE       = f"{WORKSPACE}/logs/content-scheduler.log"
TOPIC_BANK     = f"{WORKSPACE}/data/content-topics.json"
PIPELINE_CMD   = f"{WORKSPACE}/scripts/content-pipeline.py"
SUPABASE_CREDS = "/root/.dc81-supabase-credentials"

MAX_PENDING_SOCIAL = 8   # Stop if this many posts awaiting approval (4 platforms × 2 days buffer)
MAX_DRAFT_BLOGS    = 3   # Stop if this many blog drafts unreviewed

os.makedirs(f"{WORKSPACE}/logs", exist_ok=True)
os.makedirs(f"{WORKSPACE}/data", exist_ok=True)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

def load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def already_ran_today(state: dict, run_type: str) -> bool:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return state.get(f"last_{run_type}") == today

def mark_ran_today(state: dict, run_type: str):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    state[f"last_{run_type}"] = today

# ---------------------------------------------------------------------------
# Topic bank
# ---------------------------------------------------------------------------

DEFAULT_SOCIAL_TOPICS = [
    {"topic": "Why 68% of UK SME websites don't generate a single lead per month", "type": "stat", "content_type": "stat"},
    {"topic": "The one thing UK business owners keep getting wrong about AI", "type": "tip", "content_type": "tip"},
    {"topic": "How to get your first AI automation running in under a week", "type": "tip", "content_type": "tip"},
    {"topic": "What Google's local ranking update means for UK service businesses", "type": "tip", "content_type": "tip"},
    {"topic": "Why your website redesign won't fix your lead problem", "type": "tip", "content_type": "tip"},
    {"topic": "The cost of a bad hire vs the cost of an AI agent", "type": "stat", "content_type": "stat"},
    {"topic": "SEO in 2026: what still works for UK local businesses", "type": "tip", "content_type": "tip"},
    {"topic": "Three reasons UK SMEs are losing leads to faster competitors", "type": "tip", "content_type": "tip"},
    {"topic": "What a custom web app actually costs (and when it pays for itself)", "type": "tip", "content_type": "tip"},
    {"topic": "The difference between AI hype and AI that earns its keep", "type": "tip", "content_type": "tip"},
]

DEFAULT_BLOG_TOPICS = [
    "Why your website isn't generating leads (and it's not the design)",
    "How to use AI agents in your business without hiring a developer",
    "Local SEO for UK service businesses: what actually works in 2026",
    "The real cost of manual processes in a small business",
    "Custom web apps vs off-the-shelf: when does it make sense to build?",
    "What UK business owners should know about AI before they spend a penny",
    "How to turn your website into your best salesperson",
    "Why most SME AI pilots fail — and what to do instead",
]

def load_topic_bank() -> dict:
    try:
        with open(TOPIC_BANK) as f:
            return json.load(f)
    except Exception:
        bank = {
            "social": DEFAULT_SOCIAL_TOPICS.copy(),
            "blog":   [{"topic": t} for t in DEFAULT_BLOG_TOPICS],
            "used_social": [],
            "used_blog":   [],
        }
        with open(TOPIC_BANK, "w") as f:
            json.dump(bank, f, indent=2)
        return bank

def pick_topic(bank: dict, kind: str) -> dict | None:
    available = [t for t in bank.get(kind, [])
                 if t["topic"] not in bank.get(f"used_{kind}", [])]
    if not available:
        # Reset used list — cycle
        bank[f"used_{kind}"] = []
        available = bank.get(kind, [])
    if not available:
        return None
    topic = available[0]
    bank.setdefault(f"used_{kind}", []).append(topic["topic"])
    with open(TOPIC_BANK, "w") as f:
        json.dump(bank, f, indent=2)
    return topic

# ---------------------------------------------------------------------------
# Supabase checks
# ---------------------------------------------------------------------------

def load_creds(path: str) -> dict:
    creds = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, _, v = line.partition("=")
                    creds[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return creds

def sb_count(sb_url: str, sb_key: str, table: str, filters: str) -> int:
    url = f"{sb_url}/rest/v1/{table}?{filters}&select=id"
    req = urllib.request.Request(url, headers={
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Prefer": "count=exact",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            count_hdr = resp.headers.get("Content-Range", "0/0")
            total = count_hdr.split("/")[-1]
            return int(total) if total.isdigit() else 0
    except Exception as e:
        log(f"  [WARN] Count failed ({table}): {e}")
        return 0

def pending_social_count(sb_url: str, sb_key: str) -> int:
    return sb_count(sb_url, sb_key, "social_posts", "status=eq.pending_approval")

def draft_blog_count(sb_url: str, sb_key: str) -> int:
    return sb_count(sb_url, sb_key, "blog_posts", "status=eq.draft")

# ---------------------------------------------------------------------------
# Trigger ORIN to refresh topic bank when low
# ---------------------------------------------------------------------------

def maybe_refresh_topics(bank: dict):
    remaining_social = len([t for t in bank.get("social", [])
                             if t["topic"] not in bank.get("used_social", [])])
    remaining_blog   = len([t for t in bank.get("blog", [])
                             if t["topic"] not in bank.get("used_blog", [])])

    if remaining_social < 3 or remaining_blog < 2:
        log("Topic bank running low — briefing ORIN to add more topics")
        orin_brief = f"""DC81 content topic request.

The content topic bank needs replenishing.

Current remaining social topics: {remaining_social}
Current remaining blog topics:   {remaining_blog}

Please research and add 5 new social post topics and 3 new blog post topics
relevant to UK SME owners in 2026. Topics should relate to:
- AI adoption for small businesses
- Website / lead generation
- Local SEO
- Business efficiency / automation
- DC81 services: custom web apps, AI agents, SEO, app development

For each social topic, specify: topic text, content_type (tip/stat/announcement/quote)
For each blog topic: just the title/angle

Write to: {TOPIC_BANK}
Read the existing file first to avoid duplicates. Merge your additions into the JSON.
Reply DONE when written."""

        try:
            subprocess.run(
                ["openclaw", "agent", "--agent", "orin", "--message", orin_brief],
                capture_output=True, text=True, timeout=120
            )
        except Exception as e:
            log(f"  [WARN] ORIN topic refresh failed: {e}")

# ---------------------------------------------------------------------------
# Run pipeline
# ---------------------------------------------------------------------------

def run_pipeline(args: list) -> bool:
    cmd = ["python3", PIPELINE_CMD] + args
    log(f"  Running: {' '.join(cmd[2:])}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0:
            log("  Pipeline completed successfully")
            return True
        else:
            log(f"  Pipeline failed (rc={result.returncode}): {result.stderr[-300:]}")
            return False
    except subprocess.TimeoutExpired:
        log("  Pipeline timed out (600s)")
        return False
    except Exception as e:
        log(f"  Pipeline exception: {e}")
        return False

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    dry_run = "--dry-run" in sys.argv
    now     = datetime.now(timezone.utc)
    weekday = now.weekday()  # 0=Mon, 6=Sun

    log(f"content-scheduler.py start | weekday={weekday} | dry_run={dry_run}")

    # Load credentials
    creds  = load_creds(SUPABASE_CREDS)
    sb_url = creds.get("DC81_SUPABASE_URL", "").rstrip("/")
    sb_key = creds.get("DC81_SUPABASE_ANON_KEY", "")

    if not sb_url or not sb_key:
        log("[ERROR] Missing Supabase credentials — aborting")
        sys.exit(1)

    state    = load_state()
    bank     = load_topic_bank()

    # ── Saturday: blog post ───────────────────────────────────────────────
    if weekday == 5:  # Saturday
        if already_ran_today(state, "blog") and not dry_run:
            log("Blog already ran today — skipping")
        else:
            draft_count = draft_blog_count(sb_url, sb_key)
            if draft_count >= MAX_DRAFT_BLOGS:
                log(f"Too many draft blogs ({draft_count}/{MAX_DRAFT_BLOGS}) — Dominic needs to review before we draft more")
            else:
                topic_obj = pick_topic(bank, "blog")
                if not topic_obj:
                    log("No blog topics available")
                else:
                    topic = topic_obj["topic"]
                    log(f"Blog topic: {topic!r}")
                    args = ["--type", "blog", "--topic", topic]
                    if dry_run:
                        args.append("--dry-run")
                    ok = run_pipeline(args)
                    if ok and not dry_run:
                        mark_ran_today(state, "blog")
                        save_state(state)

    # ── Mon–Fri: social post ──────────────────────────────────────────────
    elif weekday <= 4:  # Mon–Fri
        if already_ran_today(state, "social") and not dry_run:
            log("Social already ran today — skipping")
        else:
            pending_count = pending_social_count(sb_url, sb_key)
            if pending_count >= MAX_PENDING_SOCIAL:
                log(f"Backlog protection: {pending_count} posts awaiting approval — pausing until Dominic reviews")
            else:
                topic_obj = pick_topic(bank, "social")
                if not topic_obj:
                    log("No social topics available")
                else:
                    topic        = topic_obj["topic"]
                    content_type = topic_obj.get("content_type", "tip")

                    # Mon/Wed/Fri: all four platforms (card always rendered)
                    # Tue/Thu: LinkedIn + Facebook (text-friendly, no card required)
                    if weekday in (0, 2, 4):
                        platforms = "linkedin,x,instagram,facebook"
                    else:
                        platforms = "linkedin,facebook"

                    log(f"Social topic: {topic!r} | platforms: {platforms}")
                    args = [
                        "--type", "social",
                        "--topic", topic,
                        "--platforms", platforms,
                        "--content-type", content_type,
                    ]
                    if dry_run:
                        args.append("--dry-run")
                    ok = run_pipeline(args)
                    if ok and not dry_run:
                        mark_ran_today(state, "social")
                        save_state(state)

    else:
        # Sunday — nothing scheduled
        log("Sunday — no content scheduled")

    # Refresh topic bank if running low
    maybe_refresh_topics(bank)

    log("content-scheduler.py done")


if __name__ == "__main__":
    main()
