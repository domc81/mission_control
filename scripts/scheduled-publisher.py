#!/usr/bin/env python3
"""
scheduled-publisher.py — DC81 Content Ops
Runs every minute via cron.
Queries social_posts for approved posts with scheduled_for <= now.
Publishes each via the Late API. Updates status to posted/failed.

Cron entry (added by Cestra, Phase 2):
* * * * * /usr/bin/python3 /root/.openclaw/workspace-cestra/scripts/scheduled-publisher.py
"""

import sys
import os
import json
import logging
import requests
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_DIR = Path("/root/.openclaw/workspace-cestra/logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "scheduled-publisher.log"

logging.basicConfig(
    filename=str(LOG_FILE),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Load credentials
# ---------------------------------------------------------------------------
def load_credentials():
    creds = {}
    for cred_file in ["/root/.dc81-supabase-credentials", "/root/.late-credentials"]:
        if os.path.exists(cred_file):
            with open(cred_file) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        creds[k.strip()] = v.strip()
    return creds


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------
def sb_headers(creds):
    key = creds.get("DC81_SUPABASE_SERVICE_ROLE_KEY") or creds.get("DC81_SUPABASE_ANON_KEY")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def get_due_posts(creds):
    """Fetch approved posts with scheduled_for <= now."""
    url = creds["DC81_SUPABASE_URL"]
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    endpoint = (
        f"{url}/rest/v1/social_posts"
        f"?status=eq.approved"
        f"&scheduled_for=lte.{now_iso}"
        f"&select=id,platform,content,media_urls,scheduled_for"
        f"&order=scheduled_for.asc"
    )
    r = requests.get(endpoint, headers=sb_headers(creds), timeout=15)
    r.raise_for_status()
    return r.json()


def update_post_status(creds, post_id, status, platform_post_id=None, error_message=None):
    url = creds["DC81_SUPABASE_URL"]
    payload = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if status == "posted":
        payload["posted_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if platform_post_id:
        payload["platform_post_id"] = platform_post_id
    if error_message:
        payload["rejection_reason"] = f"Publish error: {error_message[:500]}"

    r = requests.patch(
        f"{url}/rest/v1/social_posts?id=eq.{post_id}",
        headers=sb_headers(creds),
        json=payload,
        timeout=15,
    )
    r.raise_for_status()


# ---------------------------------------------------------------------------
# Late API helper
# ---------------------------------------------------------------------------
PLATFORM_KEY_MAP = {
    "x":              "LATE_TWITTER_ID",
    "twitter":        "LATE_TWITTER_ID",
    "linkedin":       "LATE_LINKEDIN_ID",
    "instagram":      "LATE_INSTAGRAM_ID",
    "facebook":       "LATE_FACEBOOK_ID",
    "tiktok":         "LATE_TIKTOK_ID",
    "googlebusiness": "LATE_GBP_ID",
}

LATE_PLATFORM_NAME = {
    "x":              "twitter",
    "twitter":        "twitter",
    "linkedin":       "linkedin",
    "instagram":      "instagram",
    "facebook":       "facebook",
    "tiktok":         "tiktok",
    "googlebusiness": "googlebusiness",
}


def publish_via_late(creds, post):
    api_key = creds.get("LATE_API_KEY")
    if not api_key:
        raise ValueError("LATE_API_KEY not found in credentials")

    platform = post["platform"].lower()
    account_id = creds.get(PLATFORM_KEY_MAP.get(platform, ""))
    late_platform = LATE_PLATFORM_NAME.get(platform, platform)

    if not account_id:
        raise ValueError(f"No Late account ID for platform: {platform}")

    payload = {
        "content": post["content"],
        "platforms": [{"platform": late_platform, "accountId": account_id}],
        "publishNow": True,
    }

    # Attach media if present
    media = post.get("media_urls")
    if media:
        if isinstance(media, str):
            try:
                media = json.loads(media)
            except Exception:
                media = [media] if media else []
        if media:
            payload["mediaUrls"] = media

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    r = requests.post(
        "https://getlate.dev/api/v1/posts",
        headers=headers,
        json=payload,
        timeout=30,
    )

    if r.status_code in (200, 201):
        resp = r.json()
        late_id = resp.get("post", {}).get("_id") or resp.get("_id", "unknown")
        return late_id
    else:
        raise RuntimeError(f"Late API {r.status_code}: {r.text[:300]}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    creds = load_credentials()

    if not creds.get("DC81_SUPABASE_URL"):
        log.error("DC81_SUPABASE_URL not found — aborting")
        sys.exit(1)

    try:
        posts = get_due_posts(creds)
    except Exception as e:
        log.error(f"Failed to fetch due posts: {e}")
        sys.exit(1)

    if not posts:
        log.debug("No posts due — idle")
        return

    log.info(f"Found {len(posts)} post(s) due for publishing")

    for post in posts:
        post_id = post["id"]
        platform = post.get("platform", "unknown")
        scheduled_for = post.get("scheduled_for", "?")
        log.info(f"Publishing post {post_id} | platform={platform} | scheduled_for={scheduled_for}")

        try:
            late_id = publish_via_late(creds, post)
            update_post_status(creds, post_id, "posted", platform_post_id=late_id)
            log.info(f"✓ Post {post_id} published | Late ID: {late_id}")
        except Exception as e:
            log.error(f"✗ Post {post_id} failed: {e}")
            try:
                update_post_status(creds, post_id, "failed", error_message=str(e))
            except Exception as update_err:
                log.error(f"  Also failed to update status: {update_err}")


if __name__ == "__main__":
    main()
