#!/usr/bin/env python3
"""
content-heartbeat.py — DC81 Content Ops
Called by Cestra's heartbeat to run engagement checks and posting queue review.

Usage:
    python3 content-heartbeat.py [--verbose]

Exit 0 = nothing urgent.
Exit 1 = items need Dominic's attention (details in /tmp/content-heartbeat.json).
"""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

LOG_FILE    = "/root/.openclaw/workspace-cestra/logs/content-heartbeat.log"
OUTPUT_JSON = "/tmp/content-heartbeat.json"
LATE_BASE   = "https://getlate.dev/api/v1"
WHATSAPP_TO = "+447377541121"

STALE_APPROVAL_MINUTES = 30   # re-ping after this many minutes
LATE_ENV_SCRIPT = "/root/.openclaw/workspace-cestra/scripts/load-late-env.sh"

os.makedirs("/root/.openclaw/workspace-cestra/logs", exist_ok=True)

VERBOSE = "--verbose" in sys.argv

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    if VERBOSE:
        print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

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

def load_late_env() -> dict:
    """Source the Late env script and return env vars."""
    try:
        result = subprocess.run(
            ["bash", "-c", f"source {LATE_ENV_SCRIPT} 2>/dev/null && env"],
            capture_output=True, text=True, timeout=10
        )
        env = {}
        for line in result.stdout.splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                env[k] = v
        return env
    except Exception:
        return {}

def sb_get(sb_url: str, sb_key: str, path: str) -> list:
    url = f"{sb_url}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log(f"[WARN] Supabase GET failed ({path}): {e}")
        return []

def late_get(api_key: str, path: str) -> dict:
    url = f"{LATE_BASE}/{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log(f"[WARN] Late API GET failed ({path}): {e}")
        return {}

def whatsapp_send(msg: str):
    try:
        subprocess.run(
            ["openclaw", "message", "send", "--channel", "whatsapp",
             "--to", WHATSAPP_TO, "--message", msg],
            capture_output=True, text=True, timeout=20
        )
    except Exception as e:
        log(f"[WARN] WhatsApp send failed: {e}")

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_pending_approvals(sb_url: str, sb_key: str) -> list:
    """Find posts pending approval for more than STALE_APPROVAL_MINUTES."""
    alerts = []
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=STALE_APPROVAL_MINUTES)).strftime('%Y-%m-%dT%H:%M:%S')

    table_cols = {
        "content_posts": "id,content,platforms,created_at",
        "social_posts":  "id,content,platform,created_at",
    }
    for table, cols in table_cols.items():
        rows = sb_get(sb_url, sb_key,
                      f"{table}?status=eq.pending_approval&created_at=lt.{cutoff}Z&select={cols}")
        for row in rows:
            post_id = row.get("id", "?")[:8]
            platforms = row.get("platforms") or [row.get("platform", "?")]
            created = row.get("created_at", "")[:16]
            snippet = (row.get("content") or "")[:60]
            alerts.append({
                "type": "stale_approval",
                "table": table,
                "post_id": row.get("id"),
                "post_id_short": post_id,
                "platforms": platforms,
                "created_at": created,
                "snippet": snippet,
            })
            log(f"Stale approval: {post_id} ({platforms}) since {created}")

    return alerts

def check_scheduled_posts(api_key: str) -> list:
    """Verify scheduled posts exist in Late API."""
    alerts = []
    data = late_get(api_key, "posts?status=scheduled&limit=20")
    scheduled = data.get("posts", [])
    log(f"Scheduled posts in Late: {len(scheduled)}")
    # Just report count — flag if unexpected 0 when we expect posts
    return alerts

def check_inbox(api_key: str) -> dict:
    """Check for new comments/DMs needing response."""
    summary = {"comments": 0, "conversations": 0, "reviews": 0}

    # Comments
    data = late_get(api_key, "inbox/comments?limit=20")
    comments = data.get("data", [])
    # New comments = ones with commentCount > 0 (replies exist) but we haven't replied
    # Simple heuristic: count comments received in last 24h
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    recent = []
    for c in comments:
        created = c.get("createdTime", "")
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if dt > cutoff:
                recent.append(c)
        except Exception:
            pass
    summary["comments"] = len(recent)
    if recent:
        log(f"Recent comments (24h): {len(recent)}")

    # Conversations (DMs)
    data = late_get(api_key, "inbox/conversations?limit=20")
    convos = data.get("data", [])
    unread = [c for c in convos if not c.get("read", True)]
    summary["conversations"] = len(unread)
    if unread:
        log(f"Unread DM conversations: {len(unread)}")

    # Reviews
    data = late_get(api_key, "inbox/reviews?limit=20")
    reviews = data.get("data", [])
    unanswered = [r for r in reviews if not r.get("reply")]
    summary["reviews"] = len(unanswered)
    if unanswered:
        log(f"Unanswered reviews: {len(unanswered)}")

    return summary

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log("content-heartbeat.py start")
    needs_attention = False
    output = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pending_approvals": [],
        "inbox": {},
        "alerts": [],
    }

    # Load credentials
    sb_creds = load_creds("/root/.dc81-supabase-credentials")
    sb_url = sb_creds.get("DC81_SUPABASE_URL", "").rstrip("/")
    sb_key = sb_creds.get("DC81_SUPABASE_ANON_KEY", "")

    late_env = load_late_env()
    api_key = late_env.get("LATE_API_KEY", "")

    if not sb_url or not sb_key:
        log("[WARN] Supabase credentials missing — skipping DB checks")
    else:
        # Check 1: stale pending approvals
        stale = check_pending_approvals(sb_url, sb_key)
        output["pending_approvals"] = stale
        if stale:
            needs_attention = True
            ids = ", ".join(s["post_id_short"] for s in stale)
            output["alerts"].append(f"{len(stale)} post(s) waiting approval >30min: {ids}")
            log(f"ALERT: {len(stale)} stale approvals")

    if not api_key:
        log("[WARN] LATE_API_KEY not loaded — skipping Late API checks")
    else:
        # Check 2: scheduled posts in Late
        check_scheduled_posts(api_key)

        # Check 3: inbox activity
        inbox = check_inbox(api_key)
        output["inbox"] = inbox

        if inbox["comments"] > 0:
            needs_attention = True
            output["alerts"].append(f"{inbox['comments']} new comment(s) in last 24h — may need response")

        if inbox["conversations"] > 0:
            needs_attention = True
            output["alerts"].append(f"{inbox['conversations']} unread DM conversation(s)")

        if inbox["reviews"] > 0:
            needs_attention = True
            output["alerts"].append(f"{inbox['reviews']} unanswered review(s)")

    # Write output JSON
    with open(OUTPUT_JSON, "w") as f:
        json.dump(output, f, indent=2)
    log(f"Output written to {OUTPUT_JSON}")

    if needs_attention:
        log(f"NEEDS ATTENTION: {output['alerts']}")
        # Send WhatsApp summary if stale approvals or DMs
        if output["pending_approvals"] or output["inbox"].get("conversations", 0) > 0:
            lines = ["⚠️ Content Ops alert:"]
            for alert in output["alerts"]:
                lines.append(f"  - {alert}")
            if output["pending_approvals"]:
                lines.append("\nPending approvals:")
                for s in output["pending_approvals"]:
                    lines.append(f"  APPROVE {s['post_id_short']} — {s['snippet'][:50]}")
            whatsapp_send("\n".join(lines))
        sys.exit(1)
    else:
        log("Nothing urgent — all clear")
        sys.exit(0)


if __name__ == "__main__":
    main()
