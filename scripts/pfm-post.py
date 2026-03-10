#!/usr/bin/env python3
"""
pfm-post.py
Posts an approved social_posts row to Facebook, Instagram, or LinkedIn via Post For Me.
Usage: python3 pfm-post.py <post_id>
Exit 0 on success, exit 1 on failure.
Logs all actions to /root/.openclaw/workspace-cestra/logs/pfm-post.log (JSON lines)
"""

import sys
import json
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

LOG_FILE = "/root/.openclaw/workspace-cestra/logs/pfm-post.log"

PLATFORM_MAP_KEY = {
    "linkedin": "POSTFORME_LINKEDIN_ID",
    "instagram": "POSTFORME_INSTAGRAM_ID",
    "facebook": "POSTFORME_FACEBOOK_ID",
}


# --- Logging ---
def log(entry: dict):
    entry["timestamp"] = datetime.now(timezone.utc).isoformat()
    line = json.dumps(entry) + "\n"
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line)
    except Exception as e:
        sys.stderr.write(f"Log write failed: {e}\n")


# --- Credential parsing ---
def parse_cred_file(path: str) -> dict:
    creds = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                eq = line.index("=")
                key = line[:eq].strip()
                val = line[eq + 1:].strip()
                creds[key] = val
    except Exception as e:
        sys.stderr.write(f"Error reading credentials from {path}: {e}\n")
        sys.exit(1)
    return creds


# --- Supabase REST helpers ---
def supabase_get(base_url: str, key: str, table: str, query: str) -> dict:
    url = f"{base_url}/rest/v1/{table}?{query}&select=*"
    req = urllib.request.Request(url, headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def supabase_patch(base_url: str, key: str, table: str, query: str, payload: dict):
    url = f"{base_url}/rest/v1/{table}?{query}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="PATCH", headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(req) as resp:
        return resp.status


# --- Main ---
def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Error: post_id required as first argument\n")
        sys.exit(1)

    post_id = sys.argv[1]

    # Load credentials
    pfm_creds = parse_cred_file("/root/.postforme-credentials")
    sb_creds = parse_cred_file("/root/.dc81-supabase-credentials")

    api_key = pfm_creds.get("POSTFORME_API_KEY")
    supabase_url = sb_creds.get("DC81_SUPABASE_URL")
    supabase_key = sb_creds.get("DC81_SUPABASE_ANON_KEY")

    if not api_key:
        log({"action": "validation_error", "post_id": post_id, "result": "error", "error": "Missing POSTFORME_API_KEY"})
        sys.stderr.write("Error: Missing POSTFORME_API_KEY\n")
        sys.exit(1)

    if not supabase_url or not supabase_key:
        log({"action": "validation_error", "post_id": post_id, "result": "error", "error": "Missing Supabase credentials"})
        sys.stderr.write("Error: Missing DC81_SUPABASE_URL or DC81_SUPABASE_ANON_KEY\n")
        sys.exit(1)

    # Fetch post from Supabase
    log({"action": "fetch_post", "post_id": post_id, "result": "pending"})
    try:
        rows = supabase_get(supabase_url, supabase_key, "social_posts", f"id=eq.{post_id}")
    except Exception as e:
        err = f"Supabase fetch failed: {e}"
        log({"action": "fetch_post", "post_id": post_id, "result": "error", "error": err})
        sys.stderr.write(f"Error: {err}\n")
        sys.exit(1)

    if not rows:
        err = f"Post not found: {post_id}"
        log({"action": "validation_error", "post_id": post_id, "result": "error", "error": err})
        sys.stderr.write(f"Error: {err}\n")
        sys.exit(1)

    post = rows[0]

    if post["status"] != "approved":
        err = f"Post not in approved status (actual: {post['status']})"
        log({"action": "validation_error", "post_id": post_id, "result": "error", "error": err})
        sys.stderr.write(f"Error: {err}\n")
        sys.exit(1)

    platform = post["platform"]
    if platform not in PLATFORM_MAP_KEY:
        err = f"Unsupported platform for pfm-post.py: {platform}. Use x-post.cjs for X."
        log({"action": "validation_error", "post_id": post_id, "result": "error", "error": err})
        sys.stderr.write(f"Error: {err}\n")
        sys.exit(1)

    account_id_key = PLATFORM_MAP_KEY[platform]
    account_id = pfm_creds.get(account_id_key)
    if not account_id:
        err = f"Missing credential {account_id_key} for platform {platform}"
        log({"action": "validation_error", "post_id": post_id, "result": "error", "error": err})
        sys.stderr.write(f"Error: {err}\n")
        sys.exit(1)

    content = post["content"]
    media_urls = post.get("media_urls") or []

    # Instagram requires at least one media item
    if platform == "instagram" and not media_urls:
        err = "Instagram post rejected: no media attached. Instagram requires at least one image or video."
        log({"action": "validation_error", "post_id": post_id, "platform": platform, "result": "error", "error": err})
        sys.stderr.write(f"Error: {err}\n")
        sys.exit(1)

    log({"action": "post_attempt", "post_id": post_id, "platform": platform, "account_id": account_id,
         "media_count": len(media_urls), "result": "pending"})

    # Post via Post For Me library
    try:
        from post_for_me import PostForMe
        from post_for_me._exceptions import (
            RateLimitError, AuthenticationError, APIConnectionError,
            APITimeoutError, BadRequestError, PermissionDeniedError,
            InternalServerError, PostForMeError,
        )

        client = PostForMe(api_key=api_key)

        # Build media list if any URLs present
        media_param = [{"url": url} for url in media_urls] if media_urls else None

        create_kwargs = dict(
            caption=content,
            social_accounts=[account_id],
        )
        if media_param:
            create_kwargs["media"] = media_param

        pfm_post = client.social_posts.create(**create_kwargs)

        pfm_post_id = pfm_post.id
        now = datetime.now(timezone.utc).isoformat()

        log({"action": "post_success", "post_id": post_id, "platform": platform,
             "pfm_post_id": pfm_post_id, "result": "ok"})

        # Update Supabase: posted
        try:
            supabase_patch(supabase_url, supabase_key, "social_posts", f"id=eq.{post_id}", {
                "status": "posted",
                "platform_post_id": pfm_post_id,
                "posted_at": now,
                "updated_at": now,
            })
            log({"action": "supabase_update", "post_id": post_id, "result": "ok", "pfm_post_id": pfm_post_id})
        except Exception as e:
            log({"action": "supabase_update", "post_id": post_id, "result": "error", "error": str(e)})

        sys.stdout.write(f"Posted. Post For Me ID: {pfm_post_id}\n")
        sys.exit(0)

    except RateLimitError as e:
        err = f"Rate limit exceeded: {e}"
    except AuthenticationError as e:
        err = f"Authentication failed: {e}"
    except PermissionDeniedError as e:
        err = f"Permission denied: {e}"
    except BadRequestError as e:
        err = f"Bad request: {e}"
    except APIConnectionError as e:
        err = f"Connection error: {e}"
    except APITimeoutError as e:
        err = f"Timeout: {e}"
    except InternalServerError as e:
        err = f"Post For Me server error: {e}"
    except PostForMeError as e:
        err = f"Post For Me error: {e}"
    except Exception as e:
        err = f"Unexpected error: {e}"

    # Failure path
    log({"action": "post_failed", "post_id": post_id, "platform": platform, "result": "error", "error": err})

    now = datetime.now(timezone.utc).isoformat()
    try:
        supabase_patch(supabase_url, supabase_key, "social_posts", f"id=eq.{post_id}", {
            "status": "failed",
            "updated_at": now,
        })
        log({"action": "supabase_update", "post_id": post_id, "result": "ok", "note": "marked failed"})
    except Exception as e2:
        log({"action": "supabase_update", "post_id": post_id, "result": "error", "error": str(e2)})

    sys.stderr.write(f"Error: {err}\n")
    sys.exit(1)


if __name__ == "__main__":
    main()
