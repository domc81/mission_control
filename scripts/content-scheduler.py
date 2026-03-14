#!/usr/bin/env python3
"""
content-scheduler.py — DC81 Autonomous Content Scheduler
Runs daily at 07:00 via cron. Generates all posts for the day and queues them with
correct scheduled_for timestamps. Each platform gets platform-native copy.

DAILY OUTPUT:
  Weekdays (Mon–Fri):
    07:00 cron run → Loki briefs:
      X    × 3  → 09:30, 13:00, 17:00  (punchy, different angles)
      LinkedIn × 1 → 09:00            (professional, 120-260 words)
      Instagram × 1 → 10:00           (caption + card image)
      Facebook  × 1 → 10:30           (friendly, link included)

  Saturday + Sunday:
    X    × 2  → 10:00, 14:00          (lighter weekend cadence)
    Instagram × 1 → 11:00
    Facebook  × 1 → 11:30
    (No LinkedIn on weekends)

5-3-2 MIX (across weekly output ~25 posts/week):
  5 curated   (others' content, DC81 perspective)
  3 original  (DC81 tips, stats, announcements, blog shares)
  2 personal  (real Dominic voice — no templates, no stock images)

  The topic bank tags each topic as curated/original/personal.
  Scheduler ensures the weekly batch stays on mix.

PAUSES if:
  - Already ran today (state file)
  - >15 pending_approval posts (backlog protection)
  - >3 draft blogs unreviewed

Topic bank: data/content-topics.json
State:      logs/content-scheduler-state.json
"""

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
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

MAX_PENDING_SOCIAL = 15   # 3 platforms × ~5 days buffer
MAX_DRAFT_BLOGS    = 3

os.makedirs(f"{WORKSPACE}/logs", exist_ok=True)
os.makedirs(f"{WORKSPACE}/data", exist_ok=True)

# ---------------------------------------------------------------------------
# Platform schedules — UK local time (BST = UTC+1, GMT = UTC+0)
# ---------------------------------------------------------------------------

WEEKDAY_SLOTS = {
    # platform: [(hour, minute, content_role), ...]
    # content_role: "lead" (full topic), "angle_2" (second angle), "angle_3" (third angle)
    "x":         [(9, 30, "lead"), (13, 0, "angle_2"), (17, 0, "angle_3")],
    "linkedin":  [(9, 0,  "lead")],
    "instagram": [(10, 0, "lead")],
    "facebook":  [(10, 30,"lead")],
}

WEEKEND_SLOTS = {
    "x":         [(10, 0, "lead"), (14, 0, "angle_2")],
    "instagram": [(11, 0, "lead")],
    "facebook":  [(11, 30,"lead")],
}

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

def already_ran_today(state: dict) -> bool:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return state.get("last_run") == today

def mark_ran_today(state: dict):
    state["last_run"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# ---------------------------------------------------------------------------
# UK time helpers
# ---------------------------------------------------------------------------

def uk_offset() -> timedelta:
    """BST (last Sun Mar – last Sun Oct) = UTC+1, else GMT = UTC+0."""
    now = datetime.now(timezone.utc)
    year = now.year
    # Last Sunday in March
    mar31 = datetime(year, 3, 31, 1, 0, tzinfo=timezone.utc)
    bst_start = mar31 - timedelta(days=mar31.weekday() + 1)
    # Last Sunday in October
    oct31 = datetime(year, 10, 31, 1, 0, tzinfo=timezone.utc)
    bst_end = oct31 - timedelta(days=oct31.weekday() + 1)
    if bst_start <= now < bst_end:
        return timedelta(hours=1)
    return timedelta(hours=0)

def uk_to_utc(date_uk, hour: int, minute: int) -> datetime:
    """Convert UK local time to UTC datetime."""
    offset = uk_offset()
    local_dt = datetime(date_uk.year, date_uk.month, date_uk.day, hour, minute, 0,
                        tzinfo=timezone.utc)
    return local_dt - offset

# ---------------------------------------------------------------------------
# Credentials + Supabase helpers
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
            total = resp.headers.get("Content-Range", "0/0").split("/")[-1]
            return int(total) if total.isdigit() else 0
    except Exception as e:
        log(f"  [WARN] Count failed ({table}): {e}")
        return 0

# ---------------------------------------------------------------------------
# Topic bank
# ---------------------------------------------------------------------------

# Default topics tagged with content_type (curated/original/personal) and
# platform affinity (all = any platform)
DEFAULT_SOCIAL_TOPICS = [
    # Original — DC81 perspective / tips
    {"topic": "Why 68% of UK SME websites don't generate a single lead per month",
     "content_type": "original", "post_type": "stat"},
    {"topic": "The one thing UK business owners keep getting wrong about AI",
     "content_type": "original", "post_type": "tip"},
    {"topic": "How to get your first AI automation running in under a week",
     "content_type": "original", "post_type": "tip"},
    {"topic": "What Google's local ranking update means for UK service businesses",
     "content_type": "original", "post_type": "tip"},
    {"topic": "Why your website redesign won't fix your lead problem",
     "content_type": "original", "post_type": "tip"},
    {"topic": "SEO in 2026: what still works for UK local businesses",
     "content_type": "original", "post_type": "tip"},
    {"topic": "Three reasons UK SMEs are losing leads to faster competitors",
     "content_type": "original", "post_type": "tip"},
    {"topic": "What a custom web app actually costs — and when it pays for itself",
     "content_type": "original", "post_type": "tip"},
    {"topic": "The difference between AI hype and AI that earns its keep",
     "content_type": "original", "post_type": "tip"},
    {"topic": "The cost of a bad hire vs the cost of an AI agent",
     "content_type": "original", "post_type": "stat"},
    # Curated — DC81 perspective on others' content/stats
    {"topic": "ONS: UK SME digital adoption still lags EU average by 12 points",
     "content_type": "curated", "post_type": "stat"},
    {"topic": "McKinsey: 70% of digital transformations fail — here's the real reason",
     "content_type": "curated", "post_type": "quote"},
    {"topic": "FSB report: 43% of small businesses say finding skilled staff is their top challenge",
     "content_type": "curated", "post_type": "stat"},
    {"topic": "Google: 76% of local searches result in a phone call or visit within 24h",
     "content_type": "curated", "post_type": "stat"},
    {"topic": "Deloitte UK: businesses using AI growing revenue 3x faster than those that aren't",
     "content_type": "curated", "post_type": "stat"},
]

DEFAULT_BLOG_TOPICS = [
    {"topic": "Why your website isn't generating leads (and it's not the design)",
     "content_type": "original"},
    {"topic": "How to use AI agents in your business without hiring a developer",
     "content_type": "original"},
    {"topic": "Local SEO for UK service businesses: what actually works in 2026",
     "content_type": "original"},
    {"topic": "The real cost of manual processes in a small business",
     "content_type": "original"},
    {"topic": "Custom web apps vs off-the-shelf: when does it make sense to build?",
     "content_type": "original"},
    {"topic": "What UK business owners should know about AI before they spend a penny",
     "content_type": "original"},
    {"topic": "How to turn your website into your best salesperson",
     "content_type": "original"},
    {"topic": "Why most SME AI pilots fail — and what to do instead",
     "content_type": "original"},
]

def load_topic_bank() -> dict:
    try:
        with open(TOPIC_BANK) as f:
            return json.load(f)
    except Exception:
        bank = {
            "social": DEFAULT_SOCIAL_TOPICS.copy(),
            "blog":   DEFAULT_BLOG_TOPICS.copy(),
            "used_social": [],
            "used_blog":   [],
            "weekly_mix":  {"curated": 0, "original": 0, "personal": 0, "week_start": ""},
        }
        with open(TOPIC_BANK, "w") as f:
            json.dump(bank, f, indent=2)
        return bank

def reset_weekly_mix_if_new_week(bank: dict):
    today = datetime.now(timezone.utc)
    week_start = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    if bank.get("weekly_mix", {}).get("week_start") != week_start:
        bank["weekly_mix"] = {"curated": 0, "original": 0, "personal": 0, "week_start": week_start}

def pick_topic_for_mix(bank: dict) -> dict | None:
    """Pick next topic respecting 5-3-2 cadence (per 10 posts)."""
    reset_weekly_mix_if_new_week(bank)
    mix = bank.get("weekly_mix", {})

    # Targets per 10: curated=5, original=3, personal=2
    # Determine which type is most under-target
    total = mix.get("curated", 0) + mix.get("original", 0) + mix.get("personal", 0)
    targets = {"curated": 5, "original": 3, "personal": 2}
    # Normalise to 10-post window
    cycle_pos = total % 10
    expected = {
        "curated":  round(5 * (cycle_pos + 1) / 10),
        "original": round(3 * (cycle_pos + 1) / 10),
        "personal": round(2 * (cycle_pos + 1) / 10),
    }

    # Priority: biggest deficit first
    deficit = {t: expected[t] - mix.get(t, 0) for t in targets}
    priority_type = max(deficit, key=lambda t: deficit[t])

    used = bank.get("used_social", [])
    available = [t for t in bank.get("social", [])
                 if t["topic"] not in used and t.get("content_type") == priority_type]

    if not available:
        # Fall back to any available
        available = [t for t in bank.get("social", []) if t["topic"] not in used]

    if not available:
        # Reset cycle
        bank["used_social"] = []
        bank["weekly_mix"] = {"curated": 0, "original": 0, "personal": 0,
                              "week_start": bank.get("weekly_mix", {}).get("week_start", "")}
        available = bank.get("social", [])

    if not available:
        return None

    topic = available[0]
    bank.setdefault("used_social", []).append(topic["topic"])
    ct = topic.get("content_type", "original")
    bank["weekly_mix"][ct] = bank["weekly_mix"].get(ct, 0) + 1

    with open(TOPIC_BANK, "w") as f:
        json.dump(bank, f, indent=2)
    return topic

def pick_blog_topic(bank: dict) -> dict | None:
    used = bank.get("used_blog", [])
    available = [t for t in bank.get("blog", []) if t["topic"] not in used]
    if not available:
        bank["used_blog"] = []
        available = bank.get("blog", [])
    if not available:
        return None
    topic = available[0]
    bank.setdefault("used_blog", []).append(topic["topic"])
    with open(TOPIC_BANK, "w") as f:
        json.dump(bank, f, indent=2)
    return topic

# ---------------------------------------------------------------------------
# Trigger ORIN to replenish topic bank when low
# ---------------------------------------------------------------------------

def maybe_refresh_topics(bank: dict):
    used_s = bank.get("used_social", [])
    used_b = bank.get("used_blog", [])
    remaining_social = len([t for t in bank.get("social", []) if t["topic"] not in used_s])
    remaining_blog   = len([t for t in bank.get("blog",   []) if t["topic"] not in used_b])

    if remaining_social >= 5 and remaining_blog >= 2:
        return

    log(f"Topic bank low (social={remaining_social}, blog={remaining_blog}) — briefing ORIN")
    brief = f"""DC81 topic bank replenishment.

Add to {TOPIC_BANK}:
- 8 new social post topics
- 4 new blog post topics

Rules:
- Social topics: UK SME pain points, AI adoption, local SEO, web, business efficiency
- Each social topic needs: topic (string), content_type (curated/original/personal), post_type (tip/stat/quote/announcement)
- curated = DC81's take on real external research/stats (cite source in topic)
- original = DC81's own insight or tip
- personal = Dominic's direct experience/opinion (use sparingly)
- Blog topics: original, long-form angles. topic + content_type fields only.
- No duplicates — read existing file first.

Merge your additions into the JSON arrays. Save the file. Reply DONE."""

    try:
        subprocess.run(
            ["openclaw", "agent", "--agent", "orin", "--message", brief],
            capture_output=True, text=True, timeout=120
        )
    except Exception as e:
        log(f"  [WARN] ORIN refresh failed: {e}")

# ---------------------------------------------------------------------------
# Run pipeline
# ---------------------------------------------------------------------------

def run_pipeline(args: list, label: str = "") -> bool:
    cmd = ["python3", PIPELINE_CMD] + args
    log(f"  [{label}] {' '.join(args[:6])}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0:
            log(f"  [{label}] OK")
            return True
        else:
            log(f"  [{label}] FAILED: {result.stderr[-200:]}")
            return False
    except subprocess.TimeoutExpired:
        log(f"  [{label}] timed out")
        return False
    except Exception as e:
        log(f"  [{label}] exception: {e}")
        return False

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    dry_run = "--dry-run" in sys.argv
    now     = datetime.now(timezone.utc)
    today   = (now + uk_offset()).date()  # today in UK local time
    weekday = today.weekday()             # 0=Mon, 6=Sun
    is_weekend = weekday >= 5

    log(f"content-scheduler.py start | {today} (weekday={weekday}) | dry_run={dry_run}")

    # Credentials
    creds  = load_creds(SUPABASE_CREDS)
    sb_url = creds.get("DC81_SUPABASE_URL", "").rstrip("/")
    sb_key = creds.get("DC81_SUPABASE_ANON_KEY", "")
    if not sb_url or not sb_key:
        log("[ERROR] Missing Supabase credentials")
        sys.exit(1)

    state = load_state()
    bank  = load_topic_bank()

    if already_ran_today(state) and not dry_run:
        log("Already ran today — skipping")
        sys.exit(0)

    # Backlog check
    pending = sb_count(sb_url, sb_key, "social_posts", "status=eq.pending_approval")
    drafts  = sb_count(sb_url, sb_key, "blog_posts",   "status=eq.draft")
    log(f"Backlog: {pending} pending social, {drafts} draft blogs")

    if pending >= MAX_PENDING_SOCIAL:
        log(f"Social backlog full ({pending}/{MAX_PENDING_SOCIAL}) — waiting for Dominic to approve")
        sys.exit(0)

    if drafts >= MAX_DRAFT_BLOGS:
        log(f"Blog drafts at limit ({drafts}/{MAX_DRAFT_BLOGS}) — waiting for review")

    # Pick today's topic
    topic_obj = pick_topic_for_mix(bank)
    if not topic_obj:
        log("[ERROR] No topics available")
        sys.exit(1)

    topic        = topic_obj["topic"]
    post_type    = topic_obj.get("post_type", "tip")
    content_type = topic_obj.get("content_type", "original")

    log(f"Today's topic: {topic!r} ({content_type}/{post_type})")

    # Determine slots for today
    slots = WEEKEND_SLOTS if is_weekend else WEEKDAY_SLOTS

    # Build post jobs: one pipeline call per platform × slot
    # For X with 3 slots, the first uses "lead" angle, second "angle_2", third "angle_3"
    jobs_ok = 0
    jobs_total = sum(len(v) for v in slots.items() if isinstance(v, list)
                     for _ in [None])

    for platform, time_slots in slots.items():
        for hour, minute, angle in time_slots:
            # Compute scheduled_for in UTC
            sched_utc = uk_to_utc(today, hour, minute)
            sched_iso = sched_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

            args = [
                "--type",              "social",
                "--topic",             topic,
                "--platform",          platform,
                "--content-type",      post_type,
                "--angle",             angle,
                "--scheduled-for",     sched_iso,
                "--content-mix-type",  content_type,  # curated/original/personal for 5-3-2 tracking
            ]
            if dry_run:
                args.append("--dry-run")

            label = f"{platform} {hour:02d}:{minute:02d}"
            ok = run_pipeline(args, label)
            if ok:
                jobs_ok += 1

    log(f"Social scheduling done: {jobs_ok} posts queued")

    # Saturday blog
    if weekday == 5 and drafts < MAX_DRAFT_BLOGS:
        blog_topic = pick_blog_topic(bank)
        if blog_topic:
            args = ["--type", "blog", "--topic", blog_topic["topic"]]
            if dry_run:
                args.append("--dry-run")
            run_pipeline(args, "blog")

    if not dry_run and jobs_ok > 0:
        mark_ran_today(state)
        save_state(state)

    maybe_refresh_topics(bank)
    log("content-scheduler.py done")


if __name__ == "__main__":
    main()
