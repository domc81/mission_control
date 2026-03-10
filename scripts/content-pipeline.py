#!/usr/bin/env python3
"""
content-pipeline.py — DC81 Content Ops
Master orchestrator: brief → research → copy → review → card → approval queue → WhatsApp.

Usage:
    python3 content-pipeline.py --topic "..." --platforms linkedin,twitter --type tip
    python3 content-pipeline.py --topic "..." --platforms linkedin --type blog_share --schedule "2026-03-15T09:00:00"
    python3 content-pipeline.py --topic "..." --platforms linkedin,twitter --type tip --dry-run

Content types: blog_share | tip | stat | announcement | quote
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WORKSPACE = "/root/.openclaw/workspace-cestra"
LOG_FILE  = f"{WORKSPACE}/logs/content-pipeline.log"
SCRIPTS   = f"{WORKSPACE}/scripts"

CONVEX_URL = "https://exciting-warbler-274.eu-west-1.convex.cloud/api"

CARD_TEMPLATES = {
    "blog_share":   "blog-share-card",
    "tip":          "tip-insight-card",
    "stat":         "stat-fact-card",
    "announcement": "announcement-card",
    "quote":        "quote-share-card",
}

# DC81 voice rules — injected into every Loki brief
DC81_VOICE_RULES = """DC81 VOICE RULES (apply strictly):
- Write as Dominic Clauzel, first person. "I" not "we" unless referring to DC81 the company.
- No em dashes (—). Use full stops, commas, colons, semicolons instead.
- No exclamation marks.
- No invented statistics. Only use real, citable data.
- No "In today's..." or "In the ever-evolving..." openings.
- No banned words: synergy, game-changer, leverage, cutting-edge, innovative solutions, disrupt, unlock, empower (generic), deep dive, ecosystem (products)
- Grounded, direct tone. 28-year business veteran talking to other business owners.
- X/Twitter: max 240 chars, no hashtags
- LinkedIn: 120-260 words, 3-5 hashtags at END only (not inline)
- Facebook: slightly longer than X, friendly, can adapt LinkedIn
- Every post must pass: "Would a real person engage with this or scroll past?"
"""

WHATSAPP_NUMBER = "+447377541121"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

os.makedirs(f"{WORKSPACE}/logs", exist_ok=True)

def log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def die(msg: str):
    log(f"ERROR: {msg}")
    sys.exit(1)

def load_creds(path: str) -> dict:
    creds = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                creds[k.strip()] = v.strip()
    return creds

def convex_query(path: str, args: dict) -> dict:
    payload = json.dumps({"path": path, "args": args}).encode()
    req = urllib.request.Request(
        f"{CONVEX_URL}/query", data=payload,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read()).get("value", {})

def sessions_send(session_key: str, message: str) -> bool:
    """Send a message to an agent session via OpenClaw sessions_send (best effort)."""
    # We call the OpenClaw CLI if available, otherwise log
    try:
        result = subprocess.run(
            ["openclaw", "sessions", "send", session_key, message],
            capture_output=True, text=True, timeout=15
        )
        return result.returncode == 0
    except Exception as e:
        log(f"[WARN] sessions_send to {session_key} failed: {e}")
        return False

def supabase_insert(sb_url: str, sb_key: str, table: str, row: dict) -> str:
    """Insert a row and return the generated id."""
    import urllib.parse
    data = json.dumps(row).encode()
    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    req = urllib.request.Request(
        f"{sb_url}/rest/v1/{table}",
        data=data, headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
        return result[0]["id"]

def whatsapp_send(sb_url: str, sb_key: str, msg: str):
    """Send a WhatsApp message via OpenClaw CLI."""
    try:
        result = subprocess.run(
            ["openclaw", "message", "send", "--channel", "whatsapp",
             "--to", WHATSAPP_NUMBER, "--message", msg],
            capture_output=True, text=True, timeout=20
        )
        if result.returncode != 0:
            log(f"[WARN] WhatsApp send failed: {result.stderr[:200]}")
    except Exception as e:
        log(f"[WARN] WhatsApp send exception: {e}")

# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

def step_research(topic: str, content_type: str, dry_run: bool) -> str:
    """Brief Vision on research. Returns file path (or placeholder if dry-run/offline)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug = topic.lower().replace(" ", "-")[:40]
    research_file = f"/root/.openclaw/agents/vision/agent/research-{today}-{slug}.md"

    brief = f"""Vision — research brief for DC81 content pipeline.

Topic: {topic}
Content type: {content_type}

Please research:
1. 2-3 real, citable UK stats related to this topic (from ONS, FSB, BCC, Deloitte UK, KPMG UK, or major UK media)
2. Key angle: what do UK SME owners care about here? What's the pain point?
3. Any recent news or developments (last 6 months)

Save to: {research_file}
Ping agent:cestra:main when done."""

    log(f"Briefing Vision on research: {topic}")
    sent = sessions_send("agent:vision:main", brief)
    if not sent:
        log("[WARN] Vision offline — pipeline will proceed without pre-research")
        return ""

    # Wait up to 90 seconds for Vision to write the file
    for _ in range(18):
        time.sleep(5)
        if Path(research_file).exists():
            log(f"Vision research ready: {research_file}")
            return research_file

    log("[WARN] Vision research timed out — proceeding without it")
    return ""

def step_copy(topic: str, platforms: list, content_type: str,
              research_file: str, dry_run: bool) -> dict:
    """Brief Loki on copy. Returns dict of {platform: copy_text}."""
    research_context = ""
    if research_file and Path(research_file).exists():
        research_context = f"\nResearch file: {research_file}\nRead it for stats and angles.\n"

    platform_rules = []
    for p in platforms:
        if p == "twitter":
            platform_rules.append("- X/Twitter: max 240 chars, no hashtags, punchy")
        elif p == "linkedin":
            platform_rules.append("- LinkedIn: 120-260 words, link in first comment (not in post body), 3-5 hashtags at END")
        elif p == "facebook":
            platform_rules.append("- Facebook: slightly longer than X, friendly tone, CTA with link")
        elif p == "instagram":
            platform_rules.append("- Instagram: short caption, 1 emoji max, hashtags on separate line, MUST have media")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug = topic.lower().replace(" ", "-")[:40]
    output_file = f"/root/.openclaw/agents/loki/agent/copy-{today}-{slug}.json"

    brief = f"""Loki — copywriting brief for DC81 content pipeline.

Topic: {topic}
Content type: {content_type}
Platforms: {', '.join(platforms)}
{research_context}
{DC81_VOICE_RULES}

Platform-specific rules:
{chr(10).join(platform_rules)}

Write copy for each platform. Output as JSON to: {output_file}
Format:
{{
  "twitter": "tweet text here",
  "linkedin": "linkedin post here",
  "linkedin_first_comment": "link here",
  "facebook": "facebook post here",
  "instagram": "caption here"
}}
Only include keys for the requested platforms. Ping agent:cestra:main when done."""

    log(f"Briefing Loki on copy: {topic} for {platforms}")
    sent = sessions_send("agent:loki:main", brief)

    if not sent:
        log("[WARN] Loki offline — generating placeholder copy")
        return {p: f"[PLACEHOLDER: Loki offline — brief: {topic} for {p}]" for p in platforms}

    # Wait up to 120 seconds for Loki's output
    for _ in range(24):
        time.sleep(5)
        if Path(output_file).exists():
            log(f"Loki copy ready: {output_file}")
            with open(output_file) as f:
                return json.load(f)

    log("[WARN] Loki timed out — using placeholder copy")
    return {p: f"[PLACEHOLDER: Loki timeout — topic: {topic}]" for p in platforms}

def step_kyra_review(copy_dict: dict, topic: str) -> dict:
    """Brief Kyra to review. Returns approved copy (or original if offline)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug = topic.lower().replace(" ", "-")[:40]
    review_file = f"/root/.openclaw/agents/kyra/agent/review-{today}-{slug}.json"

    brief = f"""Kyra — content review for DC81.

Topic: {topic}
Copy to review:
{json.dumps(copy_dict, indent=2)}

Check against DC81 content standards:
{DC81_VOICE_RULES}

Also check:
- Author name if mentioned: must be "Dominic Clauzel" (not Carroll, Clausel, or Clauzal)
- No references to old businesses (roofing, clinic, restaurant, tyres)
- All DC81 links must be valid: /services/custom-web-apps, /services/websites, /services/seo-consultancy, /services/ai-consultancy, /services/ai-agents, /services/app-development, /contact, /blog/*
- X/Twitter char count: max 240
- LinkedIn word count: 120-260

Output approved/corrected copy as JSON to: {review_file}
Same format as input. If a post fails review, fix it and note the change.
Ping agent:cestra:main when done."""

    log("Briefing Kyra on review")
    sent = sessions_send("agent:kyra:main", brief)

    if not sent:
        log("[WARN] Kyra offline — skipping review, using Loki copy as-is")
        return copy_dict

    for _ in range(24):
        time.sleep(5)
        if Path(review_file).exists():
            log(f"Kyra review ready: {review_file}")
            with open(review_file) as f:
                return json.load(f)

    log("[WARN] Kyra timed out — using unreviewed copy")
    return copy_dict

def step_render_card(content_type: str, copy_dict: dict, topic: str, dry_run: bool) -> str:
    """Render SVG card if applicable. Returns public card URL or empty string."""
    template = CARD_TEMPLATES.get(content_type)
    if not template:
        return ""

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug = topic.lower().replace(" ", "-")[:30]

    # Build vars based on content type — use copy to populate
    content_text = (copy_dict.get("linkedin") or copy_dict.get("twitter") or "")[:200]

    if content_type == "tip":
        words = content_text.split()
        lines = []
        current = []
        for w in words:
            current.append(w)
            if len(" ".join(current)) > 35:
                lines.append(" ".join(current[:-1]))
                current = [w]
                if len(lines) >= 4:
                    break
        if current:
            lines.append(" ".join(current))
        while len(lines) < 4:
            lines.append("")
        card_vars = {
            "TIP_LINE_1": lines[0][:40],
            "TIP_LINE_2": lines[1][:40],
            "TIP_LINE_3": lines[2][:40],
            "TIP_LINE_4": lines[3][:40],
            "TAG": "DC81",
        }
    elif content_type == "blog_share":
        card_vars = {
            "CATEGORY": "DC81",
            "CATEGORY_WIDTH": "80",
            "TITLE_LINE_1": topic[:40],
            "TITLE_LINE_2": "",
            "TITLE_LINE_3": "",
            "DATE": datetime.now(timezone.utc).strftime("%-d %B %Y"),
            "READ_TIME": "5 min read",
        }
    elif content_type == "stat":
        card_vars = {
            "STAT": topic[:30],
            "CAPTION_LINE_1": content_text[:50],
            "CAPTION_LINE_2": "",
            "SOURCE": "DC81 Research",
        }
    elif content_type == "announcement":
        card_vars = {
            "HEADLINE_LINE_1": topic[:40],
            "HEADLINE_LINE_2": "",
            "SUBTEXT_LINE_1": content_text[:50],
            "SUBTEXT_LINE_2": "",
        }
    elif content_type == "quote":
        card_vars = {
            "QUOTE_LINE_1": content_text[:40],
            "QUOTE_LINE_2": "",
            "QUOTE_LINE_3": "",
            "QUOTE_LINE_4": "",
            "AUTHOR": "Dominic Clauzel",
            "SOURCE": "DC81",
        }
    else:
        return ""

    if dry_run:
        log(f"[DRY RUN] Would render {template} with vars: {card_vars}")
        return "https://example.com/dry-run-card.png"

    log(f"Rendering card: {template}")
    try:
        result = subprocess.run(
            ["python3", f"{SCRIPTS}/render-card.py",
             "--template", template,
             "--vars", json.dumps(card_vars),
             "--slug", slug,
             "--date", today],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            card_url = result.stdout.strip()
            log(f"Card rendered: {card_url}")
            return card_url
        else:
            log(f"[WARN] Card render failed: {result.stderr[:200]}")
            return ""
    except Exception as e:
        log(f"[WARN] Card render exception: {e}")
        return ""

def step_create_posts(sb_url: str, sb_key: str, topic: str, platforms: list,
                      content_type: str, copy_dict: dict, card_url: str,
                      schedule: str, dry_run: bool) -> list:
    """Insert rows into content_posts. Returns list of inserted post IDs."""
    post_ids = []

    for platform in platforms:
        content = copy_dict.get(platform) or copy_dict.get("linkedin") or ""
        if not content or content.startswith("[PLACEHOLDER"):
            log(f"[WARN] No copy for {platform} — skipping")
            continue

        row = {
            "topic": topic,
            "content": content,
            "platforms": [platform],
            "media_urls": [card_url] if card_url else [],
            "media_types": ["image"] if card_url else [],
            "timezone": "Europe/London",
            "status": "pending_approval",
            "card_url": card_url or None,
        }

        # Per-platform first comment
        if platform == "linkedin":
            row["linkedin_first_comment"] = copy_dict.get("linkedin_first_comment") or ""
        elif platform == "instagram":
            row["instagram_first_comment"] = copy_dict.get("instagram_first_comment") or ""
        elif platform == "facebook":
            row["facebook_first_comment"] = copy_dict.get("facebook_first_comment") or ""

        if schedule:
            row["scheduled_for"] = schedule

        if dry_run:
            import uuid
            fake_id = str(uuid.uuid4())
            log(f"[DRY RUN] Would insert content_posts row for {platform}: {content[:60]}...")
            post_ids.append(fake_id)
            continue

        try:
            post_id = supabase_insert(sb_url, sb_key, "content_posts", row)
            log(f"Inserted content_posts row: {post_id} ({platform})")
            post_ids.append(post_id)
        except Exception as e:
            log(f"[ERROR] Supabase insert failed for {platform}: {e}")

    return post_ids

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="DC81 Content Pipeline")
    parser.add_argument("--topic", required=True, help="Post topic/subject")
    parser.add_argument("--platforms", required=True,
                        help="Comma-separated platforms: linkedin,twitter,facebook,instagram")
    parser.add_argument("--type", dest="content_type", required=True,
                        choices=["blog_share", "tip", "stat", "announcement", "quote"],
                        help="Content type")
    parser.add_argument("--schedule", help="ISO8601 scheduled time (e.g. 2026-03-15T09:00:00)")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen, no writes")
    args = parser.parse_args()

    platforms = [p.strip().lower() for p in args.platforms.split(",")]
    dry_run = args.dry_run

    log(f"Content pipeline start — topic={args.topic!r} platforms={platforms} type={args.content_type} dry_run={dry_run}")

    # Load Supabase creds
    creds = load_creds("/root/.dc81-supabase-credentials")
    sb_url = creds.get("DC81_SUPABASE_URL", "").rstrip("/")
    sb_key = creds.get("DC81_SUPABASE_ANON_KEY", "")
    if not sb_url or not sb_key:
        die("Missing Supabase credentials")

    # Step 1: Research (Vision)
    research_file = step_research(args.topic, args.content_type, dry_run)

    # Step 2: Copy (Loki)
    copy_dict = step_copy(args.topic, platforms, args.content_type, research_file, dry_run)
    log(f"Copy keys: {list(copy_dict.keys())}")

    # Step 3: Review (Kyra)
    copy_dict = step_kyra_review(copy_dict, args.topic)

    # Step 4: Render card
    card_url = step_render_card(args.content_type, copy_dict, args.topic, dry_run)

    # Step 5: Create Supabase rows
    post_ids = step_create_posts(sb_url, sb_key, args.topic, platforms,
                                 args.content_type, copy_dict, card_url,
                                 args.schedule, dry_run)

    if not post_ids:
        die("No posts created — check copy and platform config")

    # Step 6: WhatsApp Dominic
    card_line = f"\nCard: {card_url}" if card_url else ""
    schedule_line = f"\nScheduled: {args.schedule}" if args.schedule else "\nPublish: now (on approval)"

    id_lines = "\n".join(
        f"  {pid[:8]} ({platforms[i] if i < len(platforms) else 'unknown'})"
        for i, pid in enumerate(post_ids)
    )

    msg = (
        f"📝 Content ready for approval\n"
        f"Topic: {args.topic}\n"
        f"Type: {args.content_type} | Platforms: {', '.join(platforms)}"
        f"{schedule_line}"
        f"{card_line}\n\n"
        f"Post IDs:\n{id_lines}\n\n"
        f"Reply APPROVE <id> or REJECT <id> [reason]"
    )

    if dry_run:
        log(f"[DRY RUN] Would WhatsApp:\n{msg}")
    else:
        log("Sending WhatsApp approval request")
        whatsapp_send(sb_url, sb_key, msg)

    log(f"Pipeline complete — {len(post_ids)} post(s) queued. IDs: {post_ids}")
    print("\n".join(post_ids))


if __name__ == "__main__":
    main()
