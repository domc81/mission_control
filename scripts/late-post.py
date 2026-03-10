#!/usr/bin/env python3
"""
late-post.py — DC81 Content Ops
Posts a Supabase content record to LinkedIn, Instagram, Facebook, TikTok,
and Google Business via the Late API (https://getlate.dev/api/v1).

Usage:
    python3 late-post.py <supabase_post_id>

Environment variables required:
    LATE_API_KEY          — Late API key (sk_ prefix)
    SUPABASE_URL          — Supabase project URL
    SUPABASE_SERVICE_KEY  — Supabase service role key (bypasses RLS)

Optional env vars (Late account IDs per platform):
    LATE_ACCOUNT_LINKEDIN      — Late account _id for LinkedIn
    LATE_ACCOUNT_INSTAGRAM     — Late account _id for Instagram
    LATE_ACCOUNT_FACEBOOK      — Late account _id for Facebook
    LATE_ACCOUNT_TIKTOK        — Late account _id for TikTok
    LATE_ACCOUNT_GOOGLEBUSINESS — Late account _id for Google Business

TikTok-specific optional env vars:
    TIKTOK_PRIVACY_LEVEL  — default: PUBLIC_TO_EVERYONE
"""

import sys
import os
import json
import mimetypes
import requests
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LATE_BASE_URL = "https://getlate.dev/api/v1"

PLATFORM_ENV_MAP = {
    "linkedin":       "LATE_ACCOUNT_LINKEDIN",
    "instagram":      "LATE_ACCOUNT_INSTAGRAM",
    "facebook":       "LATE_ACCOUNT_FACEBOOK",
    "tiktok":         "LATE_ACCOUNT_TIKTOK",
    "googlebusiness": "LATE_ACCOUNT_GOOGLEBUSINESS",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def require_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"[ERROR] Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return val


def late_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def supabase_headers(service_key: str) -> dict:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def log(msg: str):
    print(f"[late-post] {msg}")


def die(msg: str):
    print(f"[ERROR] {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Supabase: fetch post record
# ---------------------------------------------------------------------------

def fetch_supabase_post(supabase_url: str, service_key: str, post_id: str) -> dict:
    """
    Fetches a single row from the `content_posts` table by ID.
    Expected columns:
        id                  TEXT PRIMARY KEY
        content             TEXT NOT NULL          — main post body
        platforms           TEXT[] NOT NULL        — e.g. ['linkedin','instagram']
        media_urls          TEXT[]                 — optional public URLs of media files
        media_types         TEXT[]                 — 'image' or 'video', parallel to media_urls
        scheduled_for       TIMESTAMPTZ            — ISO timestamp; NULL = publish now
        timezone            TEXT                   — e.g. 'Europe/London'; NULL = UTC
        first_comment       TEXT                   — optional first comment (all platforms)
        linkedin_first_comment     TEXT            — platform override
        instagram_first_comment    TEXT            — platform override
        facebook_first_comment     TEXT            — platform override
        tiktok_privacy_level       TEXT            — default PUBLIC_TO_EVERYONE
        tiktok_allow_comment       BOOLEAN         — default true
        tiktok_allow_duet          BOOLEAN         — default false
        tiktok_allow_stitch        BOOLEAN         — default false
        gbp_cta_type               TEXT            — e.g. LEARN_MORE, SHOP, BOOK
        gbp_cta_url                TEXT            — URL for CTA button
        status              TEXT                   — 'pending', 'posted', 'failed'
    """
    url = f"{supabase_url}/rest/v1/content_posts?id=eq.{post_id}&select=*"
    resp = requests.get(url, headers=supabase_headers(service_key), timeout=15)
    if resp.status_code != 200:
        die(f"Supabase fetch failed [{resp.status_code}]: {resp.text}")
    rows = resp.json()
    if not rows:
        die(f"No content_posts row found for id={post_id}")
    return rows[0]


def update_supabase_status(supabase_url: str, service_key: str, post_id: str,
                           status: str, late_post_id: str = None, error: str = None):
    payload = {"status": status}
    if late_post_id:
        payload["late_post_id"] = late_post_id
    if error:
        payload["error_message"] = error[:2000]  # column length guard
    url = f"{supabase_url}/rest/v1/content_posts?id=eq.{post_id}"
    resp = requests.patch(url, headers=supabase_headers(service_key),
                          json=payload, timeout=15)
    if resp.status_code not in (200, 204):
        log(f"[WARN] Failed to update Supabase status: {resp.status_code} {resp.text}")


# ---------------------------------------------------------------------------
# Late API: media upload
# ---------------------------------------------------------------------------

def upload_media_to_late(api_key: str, media_url: str, media_type: str) -> dict:
    """
    Downloads a media file from media_url and uploads it to Late via presigned URL.
    Returns: {"url": <publicUrl>, "type": <"image"|"video">}
    """
    log(f"  Downloading media: {media_url}")
    dl = requests.get(media_url, timeout=60)
    if dl.status_code != 200:
        die(f"Failed to download media [{dl.status_code}]: {media_url}")

    # Detect filename + content-type
    filename = Path(media_url.split("?")[0]).name or "upload"
    content_type = dl.headers.get("Content-Type") or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    # Step 1: get presigned URL
    log(f"  Requesting presigned URL for {filename} ({content_type})")
    presign_resp = requests.post(
        f"{LATE_BASE_URL}/media/presign",
        headers=late_headers(api_key),
        json={"fileName": filename, "fileType": content_type},
        timeout=15,
    )
    if presign_resp.status_code != 200:
        die(f"Late presign failed [{presign_resp.status_code}]: {presign_resp.text}")

    presign_data = presign_resp.json()
    upload_url = presign_data.get("uploadUrl")
    public_url = presign_data.get("publicUrl")
    if not upload_url or not public_url:
        die(f"Presign response missing uploadUrl or publicUrl: {presign_data}")

    # Step 2: PUT to presigned URL (no auth header)
    log(f"  Uploading {len(dl.content)} bytes to presigned URL")
    put_resp = requests.put(
        upload_url,
        data=dl.content,
        headers={"Content-Type": content_type},
        timeout=120,
    )
    if put_resp.status_code not in (200, 201, 204):
        die(f"Media PUT failed [{put_resp.status_code}]: {put_resp.text}")

    log(f"  Media uploaded → {public_url}")
    return {"url": public_url, "type": media_type}


# ---------------------------------------------------------------------------
# Build platform targets
# ---------------------------------------------------------------------------

def build_platforms(post: dict, api_key: str, account_ids: dict) -> list:
    """
    Constructs the `platforms` array for the Late API create-post request.
    Only includes platforms that have a configured account ID.
    """
    requested = post.get("platforms") or []
    platforms = []

    for platform in requested:
        account_id = account_ids.get(platform)
        if not account_id:
            log(f"[WARN] No account ID configured for platform '{platform}' — skipping")
            continue

        entry = {"platform": platform, "accountId": account_id}
        psd = {}

        # ---- LinkedIn ----
        if platform == "linkedin":
            first_comment = (
                post.get("linkedin_first_comment")
                or post.get("first_comment")
            )
            if first_comment:
                psd["firstComment"] = first_comment

        # ---- Instagram ----
        elif platform == "instagram":
            first_comment = (
                post.get("instagram_first_comment")
                or post.get("first_comment")
            )
            if first_comment:
                psd["firstComment"] = first_comment

        # ---- Facebook ----
        elif platform == "facebook":
            first_comment = (
                post.get("facebook_first_comment")
                or post.get("first_comment")
            )
            if first_comment:
                psd["firstComment"] = first_comment

        # ---- TikTok ----
        elif platform == "tiktok":
            privacy_level = (
                post.get("tiktok_privacy_level")
                or os.environ.get("TIKTOK_PRIVACY_LEVEL", "PUBLIC_TO_EVERYONE")
            )
            tiktok_settings = {
                "privacy_level":            privacy_level,
                "allow_comment":            post.get("tiktok_allow_comment", True),
                "allow_duet":               post.get("tiktok_allow_duet", False),
                "allow_stitch":             post.get("tiktok_allow_stitch", False),
                "content_preview_confirmed": True,
                "express_consent_given":    True,
            }
            psd["tiktokSettings"] = tiktok_settings

        # ---- Google Business ----
        elif platform == "googlebusiness":
            cta_type = post.get("gbp_cta_type")
            cta_url  = post.get("gbp_cta_url")
            if cta_type and cta_url:
                psd["callToAction"] = {"type": cta_type, "url": cta_url}
            elif cta_type:
                psd["callToAction"] = {"type": cta_type}

        if psd:
            entry["platformSpecificData"] = psd

        platforms.append(entry)

    return platforms


# ---------------------------------------------------------------------------
# Late API: create post
# ---------------------------------------------------------------------------

def create_late_post(api_key: str, post: dict, media_items: list,
                     platforms: list) -> dict:
    """
    Calls POST /v1/posts to create and publish (or schedule) the post.
    Returns the Late API response dict.
    """
    body = {
        "content":  post["content"],
        "platforms": platforms,
    }

    if media_items:
        body["mediaItems"] = media_items

    scheduled_for = post.get("scheduled_for")
    if scheduled_for:
        body["scheduledFor"] = scheduled_for
        tz = post.get("timezone") or "UTC"
        body["timezone"] = tz
        log(f"  Scheduling for {scheduled_for} ({tz})")
    else:
        body["publishNow"] = True
        log("  Publishing immediately (publishNow=true)")

    log(f"  POST {LATE_BASE_URL}/posts")
    log(f"  Platforms: {[p['platform'] for p in platforms]}")
    log(f"  Media items: {len(media_items)}")

    resp = requests.post(
        f"{LATE_BASE_URL}/posts",
        headers=late_headers(api_key),
        json=body,
        timeout=30,
    )

    log(f"  Response: {resp.status_code}")

    if resp.status_code not in (200, 201):
        die(f"Late create post failed [{resp.status_code}]: {resp.text}")

    return resp.json()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(f"Usage: python3 {sys.argv[0]} <supabase_post_id>", file=sys.stderr)
        sys.exit(1)

    post_id = sys.argv[1]
    log(f"Starting — post_id={post_id}")

    # Load required env vars
    api_key      = require_env("LATE_API_KEY")
    supabase_url = require_env("SUPABASE_URL").rstrip("/")
    service_key  = require_env("SUPABASE_SERVICE_KEY")

    # Collect configured account IDs (skip platforms with no account ID)
    account_ids = {}
    for platform, env_var in PLATFORM_ENV_MAP.items():
        val = os.environ.get(env_var)
        if val:
            account_ids[platform] = val
        else:
            log(f"[INFO] {env_var} not set — platform '{platform}' will be skipped if requested")

    if not account_ids:
        die("No Late account IDs configured. Set at least one LATE_ACCOUNT_* env var.")

    # 1. Fetch post from Supabase
    log("Fetching post from Supabase...")
    post = fetch_supabase_post(supabase_url, service_key, post_id)
    log(f"  content (first 80 chars): {str(post.get('content',''))[:80]!r}")
    log(f"  platforms: {post.get('platforms')}")
    log(f"  media_urls: {post.get('media_urls')}")

    if not post.get("content"):
        update_supabase_status(supabase_url, service_key, post_id, "failed",
                               error="content field is empty")
        die("Post content is empty — aborting")

    if not post.get("platforms"):
        update_supabase_status(supabase_url, service_key, post_id, "failed",
                               error="platforms array is empty")
        die("platforms array is empty — aborting")

    # 2. Upload any media to Late
    media_items = []
    raw_urls  = post.get("media_urls")  or []
    raw_types = post.get("media_types") or []

    for i, media_url in enumerate(raw_urls):
        if not media_url:
            continue
        media_type = raw_types[i] if i < len(raw_types) else "image"
        if media_type not in ("image", "video"):
            log(f"[WARN] Unknown media_type '{media_type}' at index {i}, defaulting to 'image'")
            media_type = "image"
        log(f"Uploading media [{i+1}/{len(raw_urls)}] type={media_type}...")
        item = upload_media_to_late(api_key, media_url, media_type)
        media_items.append(item)

    # 3. Build platform targets
    platforms = build_platforms(post, api_key, account_ids)
    if not platforms:
        update_supabase_status(supabase_url, service_key, post_id, "failed",
                               error="No platforms could be resolved (missing account IDs)")
        die("No platforms resolved — check LATE_ACCOUNT_* env vars")

    # 4. Create post via Late API
    log("Creating post via Late API...")
    result = create_late_post(api_key, post, media_items, platforms)

    late_post = result.get("post", {})
    late_post_id = late_post.get("_id", "unknown")
    overall_status = late_post.get("status", "unknown")

    log(f"Late post created: _id={late_post_id} status={overall_status}")

    # 5. Log per-platform results
    for p_result in late_post.get("platforms", []):
        p_name   = p_result.get("platform", "?")
        p_status = p_result.get("status", "?")
        p_url    = p_result.get("platformPostUrl", "")
        p_error  = p_result.get("error", "")
        if p_status == "published":
            log(f"  ✓ {p_name}: published — {p_url}")
        else:
            log(f"  ✗ {p_name}: {p_status} — {p_error}")

    # 5b. Post first comments (correct approach: separate API call after publish)
    # platformSpecificData.firstComment does NOT work via the create-post endpoint.
    # Must use POST /v1/inbox/comments/{latePostId} with field "message" (not "content").
    if overall_status in ("published", "scheduled"):
        for target in platforms:
            platform  = target.get("platform", "")
            psd       = target.get("platformSpecificData", {})
            first_comment = psd.get("firstComment") or ""
            account_id    = target.get("accountId", "")
            if not first_comment:
                continue
            log(f"  Posting first comment for {platform}...")
            fc_resp = requests.post(
                f"{LATE_BASE_URL}/inbox/comments/{late_post_id}",
                headers=late_headers(api_key),
                json={"message": first_comment, "accountId": account_id},
                timeout=20,
            )
            if fc_resp.status_code in (200, 201) and fc_resp.json().get("success"):
                fc_data = fc_resp.json().get("data", {})
                log(f"  ✓ First comment posted: {fc_data.get('commentId', '?')}")
            else:
                log(f"  [WARN] First comment failed [{fc_resp.status_code}]: {fc_resp.text[:200]}")

    # 6. Map Late status → Supabase status
    if overall_status == "published":
        supabase_status = "posted"
    elif overall_status in ("scheduled", "draft"):
        supabase_status = "scheduled"
    elif overall_status == "partial":
        supabase_status = "partial"
    else:
        supabase_status = "failed"

    # 7. Update Supabase
    update_supabase_status(
        supabase_url, service_key, post_id,
        status=supabase_status,
        late_post_id=late_post_id,
        error=None if supabase_status in ("posted", "scheduled") else json.dumps(late_post.get("platforms", [])),
    )

    log(f"Done — Supabase status updated to '{supabase_status}'")

    # Exit non-zero on full failure
    if supabase_status == "failed":
        sys.exit(2)


if __name__ == "__main__":
    main()
