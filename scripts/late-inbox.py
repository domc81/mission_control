#!/usr/bin/env python3
"""
late-inbox.py — DC81 Content Ops
Fetches and processes the Late API unified inbox: comments, DMs (conversations),
and reviews across connected social accounts.

Usage:
    python3 late-inbox.py [--mode comments|dms|reviews|all] [--dry-run]

Modes:
    comments   — List unread comments; optionally reply or private-reply
    dms        — List unread DM conversations; optionally send reply and mark read
    reviews    — List reviews; optionally reply to reviews
    all        — Run all three modes in sequence (default)

Options:
    --dry-run  — Fetch and print inbox items; do NOT send any replies or mark read

Environment variables required:
    LATE_API_KEY   — Late API key (sk_ prefix)

Optional:
    LATE_INBOX_LIMIT   — Max items per page (default: 50, max: 50)

Platform notes (enforced by this script):
    - TikTok:   write-only API — comments cannot be READ; skipped on list
    - Instagram: reply-only inbox (no new top-level comments via API)
    - GBP:       reviews only — no comments or DMs

Auto-reply hook:
    Set LATE_AUTO_REPLY_COMMENTS=1 to enable automatic replies to comments.
    Replies come from LATE_COMMENT_REPLY_TEXT env var (default: no auto-reply).
    Set LATE_AUTO_REPLY_DMS=1 and LATE_DM_REPLY_TEXT for DM auto-replies.
    These are intentionally conservative defaults (off) to avoid spam.

Output:
    Prints a structured summary of inbox items to stdout.
    Each action (reply sent, marked read) is logged with its outcome.

Exit codes:
    0 — success (all operations completed, even if inbox empty)
    1 — configuration/environment error
    2 — Late API error (non-recoverable)
"""

import sys
import os
import json
import argparse
import requests
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LATE_BASE_URL = "https://getlate.dev/api/v1"

# Platforms TikTok cannot READ comments from (write-only API)
COMMENT_READ_SKIP_PLATFORMS = {"tiktok"}

# Platforms that only support reviews in the inbox
REVIEWS_ONLY_PLATFORMS = {"googlebusiness"}

# Default page size (Late inbox max is 50)
DEFAULT_LIMIT = int(os.environ.get("LATE_INBOX_LIMIT", "50"))


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


def log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def warn(msg: str):
    print(f"[WARN] {msg}", file=sys.stderr)


def die(msg: str, code: int = 2):
    print(f"[ERROR] {msg}", file=sys.stderr)
    sys.exit(code)


def late_get(api_key: str, path: str, params: dict = None) -> dict:
    """
    Perform a GET against the Late API. Returns parsed JSON.
    Aborts on non-2xx with die().
    """
    url = f"{LATE_BASE_URL}{path}"
    resp = requests.get(url, headers=late_headers(api_key), params=params, timeout=20)
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After", "60")
        die(f"Rate limited (429). Retry after {retry_after}s.")
    if resp.status_code not in (200, 201):
        die(f"Late API GET {path} failed [{resp.status_code}]: {resp.text}")
    return resp.json()


def late_post(api_key: str, path: str, body: dict, dry_run: bool = False) -> dict | None:
    """
    Perform a POST against the Late API. In dry_run mode, logs and returns None.
    """
    if dry_run:
        log(f"  [DRY-RUN] POST {path} body={json.dumps(body)}")
        return None
    url = f"{LATE_BASE_URL}{path}"
    resp = requests.post(url, headers=late_headers(api_key), json=body, timeout=20)
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After", "60")
        warn(f"Rate limited (429) on POST {path}. Retry after {retry_after}s.")
        return None
    if resp.status_code not in (200, 201, 204):
        warn(f"Late API POST {path} failed [{resp.status_code}]: {resp.text}")
        return None
    return resp.json() if resp.text else {}


def late_put(api_key: str, path: str, body: dict, dry_run: bool = False) -> dict | None:
    """
    Perform a PUT against the Late API. In dry_run mode, logs and returns None.
    """
    if dry_run:
        log(f"  [DRY-RUN] PUT {path} body={json.dumps(body)}")
        return None
    url = f"{LATE_BASE_URL}{path}"
    resp = requests.put(url, headers=late_headers(api_key), json=body, timeout=20)
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After", "60")
        warn(f"Rate limited (429) on PUT {path}. Retry after {retry_after}s.")
        return None
    if resp.status_code not in (200, 201, 204):
        warn(f"Late API PUT {path} failed [{resp.status_code}]: {resp.text}")
        return None
    return resp.json() if resp.text else {}


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

def process_comments(api_key: str, dry_run: bool):
    """
    GET /v1/inbox/comments?limit=N
    For each comment:
      - Skip if platform is in COMMENT_READ_SKIP_PLATFORMS (TikTok)
      - Log comment details
      - If LATE_AUTO_REPLY_COMMENTS=1 and LATE_COMMENT_REPLY_TEXT set:
          POST /v1/inbox/comments/{postId}
          body: {"content": "...", "commentId": "...", "accountId": "..."}
    """
    log("=== COMMENTS ===")

    auto_reply    = os.environ.get("LATE_AUTO_REPLY_COMMENTS", "0") == "1"
    reply_text    = os.environ.get("LATE_COMMENT_REPLY_TEXT", "").strip()
    private_reply = os.environ.get("LATE_COMMENT_PRIVATE_REPLY", "0") == "1"

    if auto_reply and not reply_text:
        warn("LATE_AUTO_REPLY_COMMENTS=1 but LATE_COMMENT_REPLY_TEXT is not set — auto-reply disabled")
        auto_reply = False

    data = late_get(api_key, "/inbox/comments", params={"limit": DEFAULT_LIMIT})

    # Normalise response: may be list or {"comments": [...]}
    comments = data if isinstance(data, list) else data.get("comments", [])
    log(f"  Fetched {len(comments)} comment(s)")

    replied = 0
    skipped = 0

    for comment in comments:
        platform   = (comment.get("platform") or "").lower()
        comment_id = comment.get("_id") or comment.get("id", "")
        post_id    = comment.get("postId", "")
        account_id = comment.get("accountId", "")
        author     = comment.get("author") or comment.get("username", "unknown")
        text       = comment.get("text") or comment.get("content", "")
        created_at = comment.get("createdAt", "")

        # Skip platforms with write-only comment APIs
        if platform in COMMENT_READ_SKIP_PLATFORMS:
            log(f"  [SKIP] {platform} comment (read not supported): {comment_id}")
            skipped += 1
            continue

        log(f"  [{platform}] @{author} ({created_at}): {text[:120]!r}")

        if not auto_reply:
            continue

        if not post_id:
            warn(f"  Cannot reply to comment {comment_id}: missing postId")
            continue

        if private_reply:
            # POST /v1/inbox/comments/{postId}/{commentId}/private-reply
            path = f"/inbox/comments/{post_id}/{comment_id}/private-reply"
            body = {"content": reply_text}
            result = late_post(api_key, path, body, dry_run=dry_run)
        else:
            # POST /v1/inbox/comments/{postId}
            path = f"/inbox/comments/{post_id}"
            body = {
                "content":   reply_text,
                "commentId": comment_id,
                "accountId": account_id,
            }
            result = late_post(api_key, path, body, dry_run=dry_run)

        if result is not None or dry_run:
            log(f"    → {'[DRY-RUN] ' if dry_run else ''}Replied{'(private)' if private_reply else ''} to comment {comment_id}")
            replied += 1

    log(f"  Summary: {len(comments)} comments | {replied} replied | {skipped} skipped")


# ---------------------------------------------------------------------------
# DMs / Conversations
# ---------------------------------------------------------------------------

def process_dms(api_key: str, dry_run: bool):
    """
    GET /v1/inbox/conversations?limit=N
    For each unread conversation:
      - Log conversation details
      - If LATE_AUTO_REPLY_DMS=1 and LATE_DM_REPLY_TEXT set:
          POST /v1/inbox/conversations/{conversationId}/messages
          body: {"content": "..."}
      - Mark conversation as read:
          PUT /v1/inbox/conversations/{conversationId}
          body: {"read": true}
    """
    log("=== DMs / CONVERSATIONS ===")

    auto_reply = os.environ.get("LATE_AUTO_REPLY_DMS", "0") == "1"
    reply_text = os.environ.get("LATE_DM_REPLY_TEXT", "").strip()
    mark_read  = os.environ.get("LATE_MARK_DMS_READ", "1") == "1"

    if auto_reply and not reply_text:
        warn("LATE_AUTO_REPLY_DMS=1 but LATE_DM_REPLY_TEXT is not set — auto-reply disabled")
        auto_reply = False

    data = late_get(api_key, "/inbox/conversations", params={"limit": DEFAULT_LIMIT})

    conversations = data if isinstance(data, list) else data.get("conversations", [])
    log(f"  Fetched {len(conversations)} conversation(s)")

    replied  = 0
    marked   = 0

    for conv in conversations:
        conv_id    = conv.get("_id") or conv.get("id", "")
        platform   = (conv.get("platform") or "").lower()
        is_read    = conv.get("read", False)
        participant = conv.get("participant") or conv.get("username", "unknown")
        last_msg   = conv.get("lastMessage") or {}
        last_text  = last_msg.get("text") or last_msg.get("content", "")
        created_at = conv.get("updatedAt") or conv.get("createdAt", "")

        # GBP has no DMs
        if platform in REVIEWS_ONLY_PLATFORMS:
            log(f"  [SKIP] {platform} conversation (reviews only)")
            continue

        read_flag = "READ" if is_read else "UNREAD"
        log(f"  [{platform}] {read_flag} | @{participant} ({created_at}): {last_text[:100]!r}")

        # Auto-reply (only to unread conversations to avoid duplicate replies)
        if auto_reply and not is_read:
            path = f"/inbox/conversations/{conv_id}/messages"
            body = {"content": reply_text}
            result = late_post(api_key, path, body, dry_run=dry_run)
            if result is not None or dry_run:
                log(f"    → {'[DRY-RUN] ' if dry_run else ''}DM reply sent to conversation {conv_id}")
                replied += 1

        # Mark as read
        if mark_read and not is_read:
            path = f"/inbox/conversations/{conv_id}"
            result = late_put(api_key, path, {"read": True}, dry_run=dry_run)
            if result is not None or dry_run:
                log(f"    → {'[DRY-RUN] ' if dry_run else ''}Marked conversation {conv_id} as read")
                marked += 1

    log(f"  Summary: {len(conversations)} conversations | {replied} replied | {marked} marked read")


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------

def process_reviews(api_key: str, dry_run: bool):
    """
    GET /v1/inbox/reviews?limit=N
    For each review:
      - Log review details
      - If LATE_AUTO_REPLY_REVIEWS=1 and LATE_REVIEW_REPLY_TEXT set:
          POST /v1/inbox/reviews/{reviewId}/reply
          body: {"content": "..."}
    """
    log("=== REVIEWS ===")

    auto_reply = os.environ.get("LATE_AUTO_REPLY_REVIEWS", "0") == "1"
    reply_text = os.environ.get("LATE_REVIEW_REPLY_TEXT", "").strip()

    if auto_reply and not reply_text:
        warn("LATE_AUTO_REPLY_REVIEWS=1 but LATE_REVIEW_REPLY_TEXT is not set — auto-reply disabled")
        auto_reply = False

    data = late_get(api_key, "/inbox/reviews", params={"limit": DEFAULT_LIMIT})

    reviews = data if isinstance(data, list) else data.get("reviews", [])
    log(f"  Fetched {len(reviews)} review(s)")

    replied = 0

    for review in reviews:
        review_id  = review.get("_id") or review.get("id", "")
        platform   = (review.get("platform") or "").lower()
        author     = review.get("author") or review.get("reviewer", {}).get("displayName", "unknown")
        rating     = review.get("rating") or review.get("starRating", "?")
        text       = review.get("text") or review.get("comment", "")
        created_at = review.get("createdAt", "")
        has_reply  = bool(review.get("reply") or review.get("reviewReply"))

        replied_flag = "REPLIED" if has_reply else "NO REPLY"
        log(f"  [{platform}] {replied_flag} | {author} ★{rating} ({created_at}): {text[:120]!r}")

        # Skip if already replied
        if has_reply:
            continue

        if not auto_reply:
            continue

        if not review_id:
            warn("  Cannot reply to review: missing review ID")
            continue

        path = f"/inbox/reviews/{review_id}/reply"
        body = {"content": reply_text}
        result = late_post(api_key, path, body, dry_run=dry_run)
        if result is not None or dry_run:
            log(f"    → {'[DRY-RUN] ' if dry_run else ''}Reply sent to review {review_id}")
            replied += 1

    log(f"  Summary: {len(reviews)} reviews | {replied} replied")


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Late API inbox processor — comments, DMs, reviews"
    )
    parser.add_argument(
        "--mode",
        choices=["comments", "dms", "reviews", "all"],
        default="all",
        help="Which inbox section to process (default: all)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        dest="dry_run",
        help="Fetch and log only; do not send replies or mark as read",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = parse_args()

    api_key = require_env("LATE_API_KEY")

    mode    = args.mode
    dry_run = args.dry_run

    if dry_run:
        log("[DRY-RUN MODE ACTIVE — no writes will occur]")

    log(f"Starting late-inbox.py | mode={mode} | dry_run={dry_run}")

    if mode in ("comments", "all"):
        process_comments(api_key, dry_run)

    if mode in ("dms", "all"):
        process_dms(api_key, dry_run)

    if mode in ("reviews", "all"):
        process_reviews(api_key, dry_run)

    log("Done.")


if __name__ == "__main__":
    main()
