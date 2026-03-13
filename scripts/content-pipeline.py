#!/usr/bin/env python3
"""
content-pipeline.py — DC81 Autonomous Content Pipeline
Orchestrates: topic generation → Vision research → Loki copy → Kyra review → Supabase → WhatsApp approval.

For SOCIAL posts:
  - Writes one row per platform to social_posts (status=pending_approval)
  - Sends WhatsApp approval request to Dominic
  - approve-post.sh handles publishing on approval

For BLOG posts:
  - Loki drafts full post → Kyra reviews → writes to blog_posts (status=draft)
  - Dominic reviews in MC Blog section and publishes manually

Usage (called by content-scheduler.py — not by humans):
  python3 content-pipeline.py --type social --topic "UK SME AI adoption" --platforms linkedin,x --content-type tip
  python3 content-pipeline.py --type blog --topic "Why your website isn't generating leads"
  python3 content-pipeline.py --dry-run --type social --topic "test" --platforms x --content-type tip
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

WORKSPACE   = "/root/.openclaw/workspace-cestra"
LOG_FILE    = f"{WORKSPACE}/logs/content-pipeline.log"
CONVEX_URL  = "https://exciting-warbler-274.eu-west-1.convex.cloud/api"
SUPABASE_CREDS = "/root/.dc81-supabase-credentials"
WHATSAPP_TO = "+447377541121"

DC81_VOICE_RULES = """DC81 VOICE RULES — apply strictly to every word:
- Write as Dominic Clauzel, first person. "I" not "we" unless referring to DC81 the company.
- No em dashes (—). Full stops, commas, colons, semicolons, or parentheses only.
- No exclamation marks.
- No invented statistics. Only real, citable UK data (ONS, FSB, BCC, Deloitte UK, KPMG UK, major UK media).
- No "In today's..." / "In the ever-evolving..." openings — content mill clichés.
- Banned words: synergy, game-changer, leverage, cutting-edge, innovative solutions, disrupt, unlock, empower (generic), deep dive, ecosystem (products)
- Tone: 28-year business veteran talking to other UK business owners. Direct. No hype.
- Every post must pass: "Would a real person engage with this or scroll past?"
"""

PLATFORM_RULES = {
    "x":         "Max 240 chars. No hashtags. Punchy opener. No link in post body.",
    "linkedin":  "120-260 words. One clear point. End with question or CTA. 3-5 hashtags at END only, never inline. No link in post body (put it in first comment).",
    "facebook":  "Slightly longer than X, friendly tone, CTA. Can include link. Adapt from LinkedIn copy.",
    "instagram": "Short caption (1-3 sentences). Max 1 emoji. Hashtags on separate line (5-8 relevant tags). The card image IS the visual — your caption just needs to hook them.",
}

# content_type → card template mapping
CARD_TEMPLATES = {
    "tip":          "tip-insight-card",
    "stat":         "stat-fact-card",
    "announcement": "announcement-card",
    "quote":        "quote-share-card",
    "blog_share":   "blog-share-card",
}

# ---------------------------------------------------------------------------
# Logging
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

# ---------------------------------------------------------------------------
# Credentials
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

# ---------------------------------------------------------------------------
# Agent messaging — uses `openclaw agent` CLI (correct syntax)
# ---------------------------------------------------------------------------

def agent_send(agent_id: str, message: str, timeout: int = 180) -> bool:
    """Send a message to an agent via openclaw agent CLI and wait for completion."""
    try:
        result = subprocess.run(
            ["openclaw", "agent", "--agent", agent_id, "--message", message],
            capture_output=True, text=True, timeout=timeout
        )
        if result.returncode == 0:
            log(f"  → {agent_id}: message delivered")
            return True
        else:
            log(f"  [WARN] {agent_id} send failed (rc={result.returncode}): {result.stderr[:150]}")
            return False
    except subprocess.TimeoutExpired:
        log(f"  [WARN] {agent_id} timed out after {timeout}s")
        return False
    except Exception as e:
        log(f"  [WARN] {agent_id} send exception: {e}")
        return False

# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def sb_insert(sb_url: str, sb_key: str, table: str, row: dict) -> str | None:
    data = json.dumps(row).encode()
    req = urllib.request.Request(
        f"{sb_url}/rest/v1/{table}",
        data=data,
        headers={
            "apikey": sb_key,
            "Authorization": f"Bearer {sb_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return result[0]["id"]
    except Exception as e:
        log(f"  [ERROR] Supabase INSERT {table}: {e}")
        return None

# ---------------------------------------------------------------------------
# WhatsApp
# ---------------------------------------------------------------------------

def whatsapp(msg: str):
    try:
        result = subprocess.run(
            ["openclaw", "message", "send",
             "--channel", "whatsapp",
             "--to", WHATSAPP_TO,
             "--message", msg],
            capture_output=True, text=True, timeout=20
        )
        if result.returncode != 0:
            log(f"  [WARN] WhatsApp failed: {result.stderr[:150]}")
    except Exception as e:
        log(f"  [WARN] WhatsApp exception: {e}")

# ---------------------------------------------------------------------------
# Wait for file (agent writes output to disk)
# ---------------------------------------------------------------------------

def render_card(content_type: str, topic: str, copy_dict: dict, dry_run: bool) -> str:
    """Render SVG card to PNG, upload to Supabase. Returns public URL or '' on failure."""
    template = CARD_TEMPLATES.get(content_type)
    if not template:
        log(f"  No card template for content_type={content_type!r} — skipping card")
        return ""

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug  = "".join(c if c.isalnum() or c == "-" else "-"
                    for c in topic.lower().replace(" ", "-"))[:30].strip("-")

    # Build card vars from copy
    main_copy = (copy_dict.get("linkedin") or copy_dict.get("x") or "")

    if content_type == "tip":
        # Word-wrap into up to 4 lines of ~38 chars
        words, lines, cur = main_copy.split(), [], []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 38:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
                if len(lines) == 4:
                    break
        if cur and len(lines) < 4:
            lines.append(" ".join(cur))
        while len(lines) < 4:
            lines.append("")
        card_vars = {
            "TIP_LINE_1": lines[0][:40],
            "TIP_LINE_2": lines[1][:40],
            "TIP_LINE_3": lines[2][:40],
            "TIP_LINE_4": lines[3][:40],
            "TAG": "DC81",
        }
    elif content_type == "stat":
        card_vars = {
            "STAT":          topic[:30],
            "CAPTION_LINE_1": main_copy[:55],
            "CAPTION_LINE_2": "",
            "SOURCE":         "DC81 Research",
        }
    elif content_type == "announcement":
        card_vars = {
            "HEADLINE_LINE_1": topic[:40],
            "HEADLINE_LINE_2": "",
            "SUBTEXT_LINE_1":  main_copy[:55],
            "SUBTEXT_LINE_2":  "",
        }
    elif content_type == "quote":
        words = main_copy.split()
        lines, cur = [], []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 38:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
                if len(lines) == 4:
                    break
        if cur and len(lines) < 4:
            lines.append(" ".join(cur))
        while len(lines) < 4:
            lines.append("")
        card_vars = {
            "QUOTE_LINE_1": lines[0][:40],
            "QUOTE_LINE_2": lines[1][:40],
            "QUOTE_LINE_3": lines[2][:40],
            "QUOTE_LINE_4": lines[3][:40],
            "AUTHOR":        "Dominic Clauzel",
            "SOURCE":        "DC81",
        }
    elif content_type == "blog_share":
        card_vars = {
            "CATEGORY":       "DC81",
            "CATEGORY_WIDTH": "80",
            "TITLE_LINE_1":   topic[:40],
            "TITLE_LINE_2":   "",
            "TITLE_LINE_3":   "",
            "DATE":           datetime.now(timezone.utc).strftime("%-d %B %Y"),
            "READ_TIME":      "5 min read",
        }
    else:
        return ""

    if dry_run:
        log(f"  [DRY RUN] Would render {template} for {slug}")
        return "https://example.com/dry-run-card.png"

    log(f"  Rendering card: {template}")
    try:
        result = subprocess.run(
            ["python3", f"{WORKSPACE}/scripts/render-card.py",
             "--template", template,
             "--vars",     json.dumps(card_vars),
             "--slug",     slug,
             "--date",     today],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            log(f"  Card ready: {url}")
            return url
        else:
            log(f"  [WARN] Card render failed: {result.stderr[-200:]}")
            return ""
    except Exception as e:
        log(f"  [WARN] Card render exception: {e}")
        return ""


def wait_for_file(path: str, max_wait: int = 120) -> bool:
    for _ in range(max_wait // 5):
        if Path(path).exists() and Path(path).stat().st_size > 10:
            return True
        time.sleep(5)
    return False

# ---------------------------------------------------------------------------
# SOCIAL PIPELINE
# ---------------------------------------------------------------------------

def run_social_pipeline(topic: str, platforms: list, content_type: str,
                        dry_run: bool, sb_url: str, sb_key: str):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug  = topic.lower().replace(" ", "-")[:40]

    log(f"[SOCIAL] Topic: {topic!r} | Platforms: {platforms} | Type: {content_type}")

    # ── Step 1: Vision — research ──────────────────────────────────────────
    research_file = f"/root/.openclaw/agents/vision/agent/research-{today}-{slug}.md"
    log("Step 1: Vision research")

    vision_brief = f"""DC81 content research request.

Topic: {topic}
For: {content_type} post on {', '.join(platforms)}

Research and write to: {research_file}

Find:
1. 2-3 real, citable UK statistics on this topic (ONS, FSB, BCC, Deloitte UK, KPMG UK, UK national press)
2. Core pain point for UK SME owners around this topic
3. Any relevant news or developments in the last 6 months

Format as a short markdown file. Be factual — no invented data.
Save the file, then reply DONE."""

    if not dry_run:
        sent = agent_send("vision", vision_brief, timeout=150)
        if sent:
            found = wait_for_file(research_file, max_wait=120)
            if found:
                log(f"  Research ready: {research_file}")
            else:
                log("  Research file not written — proceeding without it")
        research_context = f"\nRead research file: {research_file}\n" if Path(research_file).exists() else ""
    else:
        research_context = "\n[DRY RUN — no research]\n"

    # ── Step 2: Loki — copy ────────────────────────────────────────────────
    copy_file = f"/root/.openclaw/agents/loki/agent/copy-{today}-{slug}.json"
    log("Step 2: Loki copy")

    platform_specs = "\n".join(
        f"- {p}: {PLATFORM_RULES.get(p, 'Standard rules apply.')}"
        for p in platforms
    )

    loki_brief = f"""DC81 copywriting task.

Topic: {topic}
Content type: {content_type}
Platforms: {', '.join(platforms)}
{research_context}
{DC81_VOICE_RULES}

Platform specs:
{platform_specs}

Write copy for EACH platform. Output as a JSON file to: {copy_file}

Format (include only requested platforms):
{{
  "x": "tweet text",
  "linkedin": "post body",
  "linkedin_first_comment": "DC81 service link for first comment e.g. https://dc81.io/services/ai-agents",
  "facebook": "facebook post (can include link)",
  "instagram": "short caption — remember the card image is the visual, caption just needs to hook them. End with hashtags on a new line."
}}

Save the file. Reply DONE."""

    copy_dict = {}
    if not dry_run:
        sent = agent_send("loki", loki_brief, timeout=150)
        if sent:
            found = wait_for_file(copy_file, max_wait=120)
            if found:
                log(f"  Copy ready: {copy_file}")
                with open(copy_file) as f:
                    copy_dict = json.load(f)
            else:
                log("  Copy file not written — aborting pipeline run")
                return
        else:
            log("  Loki unreachable — aborting")
            return
    else:
        copy_dict = {p: f"[DRY RUN copy for {p}]" for p in platforms}

    # ── Step 3: Kyra — review ──────────────────────────────────────────────
    review_file = f"/root/.openclaw/agents/kyra/agent/review-{today}-{slug}.json"
    log("Step 3: Kyra review")

    kyra_brief = f"""DC81 copy review task.

Topic: {topic}
Copy to review:
{json.dumps(copy_dict, indent=2)}

{DC81_VOICE_RULES}

Also check:
- Author name if mentioned: must be "Dominic Clauzel"
- No old business references (roofing, clinic, restaurant, tyres)
- Valid DC81 links only: /services/custom-web-apps, /services/websites, /services/seo-consultancy, /services/ai-consultancy, /services/ai-agents, /services/app-development, /contact
- X char count ≤240, LinkedIn word count 120-260

Fix any issues. Output approved/corrected copy as JSON to: {review_file}
Same format as input. Save file. Reply DONE."""

    if not dry_run:
        sent = agent_send("kyra", kyra_brief, timeout=120)
        if sent:
            found = wait_for_file(review_file, max_wait=90)
            if found:
                log(f"  Review ready: {review_file}")
                with open(review_file) as f:
                    copy_dict = json.load(f)
            else:
                log("  Kyra review timed out — using Loki copy as-is")

    # ── Step 4: Render card (Instagram requires it; Facebook + others benefit) ─
    log("Step 4: Render card")
    card_url = render_card(content_type, topic, copy_dict, dry_run)
    if not card_url:
        log("  Card render failed — Instagram will be skipped this run")

    # ── Step 5: Insert to social_posts ─────────────────────────────────────
    log("Step 5: Supabase inserts")
    post_ids    = []
    posted_plats = []

    for platform in platforms:
        # Instagram: must have media — drop if no card
        if platform == "instagram" and not card_url:
            log(f"  Skipping instagram — no card available")
            continue

        copy_text = copy_dict.get(platform) or copy_dict.get("linkedin") or ""
        if not copy_text or copy_text.startswith("[DRY RUN"):
            if dry_run:
                post_ids.append(f"dry-run-{platform}")
                posted_plats.append(platform)
                continue
            log(f"  [WARN] No copy for {platform} — skipping")
            continue

        row = {
            "platform":     platform,
            "content":      copy_text,
            "status":       "pending_approval",
            "content_type": "original",
        }
        # Attach card as media for Instagram and Facebook; LinkedIn/X use it in approval message
        if card_url and platform in ("instagram", "facebook"):
            row["media_urls"] = [card_url]

        if dry_run:
            log(f"  [DRY RUN] Would insert: {platform} | {copy_text[:60]}...")
            post_ids.append(f"dry-run-{platform}")
            posted_plats.append(platform)
        else:
            post_id = sb_insert(sb_url, sb_key, "social_posts", row)
            if post_id:
                log(f"  Inserted: {post_id[:8]} ({platform})")
                post_ids.append(post_id)
                posted_plats.append(platform)

    if not post_ids:
        log("  No posts created — pipeline aborted")
        return

    # ── Step 6: WhatsApp approval ──────────────────────────────────────────
    log("Step 6: WhatsApp to Dominic")

    snippets = []
    for i, pid in enumerate(post_ids):
        plat = posted_plats[i] if i < len(posted_plats) else "?"
        copy_text = copy_dict.get(plat, "")
        snippets.append(f"{plat.upper()} ({pid[:8]}): {copy_text[:80]}{'...' if len(copy_text) > 80 else ''}")

    card_line = f"\nCard: {card_url}" if card_url else ""

    msg = (
        f"📝 Content ready for approval\n"
        f"Topic: {topic}\n"
        f"Type: {content_type} | {', '.join(posted_plats)}"
        f"{card_line}\n\n"
        + "\n\n".join(snippets)
        + f"\n\nReply: APPROVE <id> or REJECT <id> <reason>"
    )

    if dry_run:
        log(f"  [DRY RUN] WhatsApp:\n{msg}")
    else:
        whatsapp(msg)

    log(f"[SOCIAL] Pipeline complete — {len(post_ids)} posts queued on {posted_plats}")

# ---------------------------------------------------------------------------
# BLOG PIPELINE
# ---------------------------------------------------------------------------

def run_blog_pipeline(topic: str, dry_run: bool, sb_url: str, sb_key: str):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug  = topic.lower().replace(" ", "-")[:50]
    # Normalise slug to URL-safe
    slug  = "".join(c if c.isalnum() or c == "-" else "" for c in slug).strip("-")

    log(f"[BLOG] Topic: {topic!r}")

    # ── Step 1: Vision — research ──────────────────────────────────────────
    research_file = f"/root/.openclaw/agents/vision/agent/blog-research-{today}-{slug}.md"
    log("Step 1: Vision research")

    vision_brief = f"""DC81 blog research request.

Topic: {topic}

Research and write to: {research_file}

Find:
1. 3-5 real, citable UK statistics relevant to this topic
2. Common objections or misconceptions UK SME owners have about this topic
3. 3-4 practical subtopics or angles worth covering
4. Any relevant case studies or industry reports (UK focus)

Format as structured markdown. Be factual. Save file. Reply DONE."""

    if not dry_run:
        sent = agent_send("vision", vision_brief, timeout=150)
        if sent:
            found = wait_for_file(research_file, max_wait=120)
            log(f"  Research: {'ready' if found else 'timed out — proceeding anyway'}")
        research_context = f"\nResearch file: {research_file}\n" if Path(research_file).exists() else ""
    else:
        research_context = "\n[DRY RUN — no research]\n"

    # ── Step 2: Loki — full blog post ─────────────────────────────────────
    draft_file = f"/root/.openclaw/agents/loki/agent/blog-{today}-{slug}.md"
    log("Step 2: Loki blog draft")

    loki_brief = f"""DC81 blog post writing task.

Topic: {topic}
{research_context}
{DC81_VOICE_RULES}

Write a full blog post for dc81.io. Requirements:
- Length: 800-1200 words
- Author: Dominic Clauzel
- Audience: UK small business owners (any industry)
- Structure: engaging intro → 3-4 substantive sections → concrete conclusion with CTA
- Tone: direct, practical, opinionated — like a business owner writing to peers, not a marketing department
- No bullet-point walls. Use bullets sparingly, only where genuinely list-like
- CTA at end: link to relevant DC81 service (/services/ai-consultancy, /services/ai-agents, /services/custom-web-apps, etc.) or /contact
- SEO: natural, not forced. Include the topic phrase 2-3 times naturally.

Output a JSON file to: {draft_file}
Format:
{{
  "slug": "{slug}",
  "title": "Post title",
  "excerpt": "1-2 sentence excerpt for blog index",
  "category": "AI | Tech | Business | SEO | Web",
  "meta_title": "SEO title (max 60 chars)",
  "meta_desc": "SEO description (max 155 chars)",
  "read_time": "N min read",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "service_link": "/services/...",
  "hero_icon": "Brain",
  "content": "Full markdown post body here"
}}

Save the file. Reply DONE."""

    blog_draft = {}
    if not dry_run:
        sent = agent_send("loki", loki_brief, timeout=240)
        if sent:
            found = wait_for_file(draft_file, max_wait=180)
            if found:
                log(f"  Draft ready: {draft_file}")
                with open(draft_file) as f:
                    blog_draft = json.load(f)
            else:
                log("  Blog draft not written — aborting")
                return
        else:
            log("  Loki unreachable — aborting")
            return
    else:
        blog_draft = {
            "slug": slug, "title": f"[DRY RUN] {topic}",
            "excerpt": "Dry run excerpt", "category": "AI",
            "meta_title": topic[:60], "meta_desc": topic[:155],
            "read_time": "5 min read", "keywords": [],
            "service_link": "/contact", "hero_icon": "Brain",
            "content": "[DRY RUN content]"
        }

    # ── Step 3: Kyra — review ─────────────────────────────────────────────
    review_file = f"/root/.openclaw/agents/kyra/agent/blog-review-{today}-{slug}.json"
    log("Step 3: Kyra review")

    kyra_brief = f"""DC81 blog post review task.

Topic: {topic}
Draft:
{json.dumps(blog_draft, indent=2)[:3000]}

{DC81_VOICE_RULES}

Also check:
- Author attribution: Dominic Clauzel
- No old business references
- All links are valid DC81 service pages or /contact
- Slug is URL-safe (lowercase, hyphens only)
- Meta title ≤60 chars, meta desc ≤155 chars
- Content is substantive — not generic AI filler

Fix any issues. Output corrected JSON to: {review_file}
Same format as input. Save file. Reply DONE."""

    if not dry_run:
        sent = agent_send("kyra", kyra_brief, timeout=120)
        if sent:
            found = wait_for_file(review_file, max_wait=90)
            if found:
                log(f"  Review ready: {review_file}")
                with open(review_file) as f:
                    blog_draft = json.load(f)
            else:
                log("  Kyra timed out — using Loki draft as-is")

    # ── Step 4: Insert to blog_posts ──────────────────────────────────────
    log("Step 4: Supabase blog_posts insert")

    row = {
        "slug":        blog_draft.get("slug", slug),
        "title":       blog_draft.get("title", topic),
        "date":        today,
        "category":    blog_draft.get("category", "AI"),
        "excerpt":     blog_draft.get("excerpt", ""),
        "meta_title":  blog_draft.get("meta_title", topic[:60]),
        "meta_desc":   blog_draft.get("meta_desc", ""),
        "read_time":   blog_draft.get("read_time", "5 min read"),
        "keywords":    blog_draft.get("keywords", []),
        "service_link": blog_draft.get("service_link", "/contact"),
        "author":      "Dominic Clauzel",
        "hero_icon":   blog_draft.get("hero_icon", "Brain"),
        "content":     blog_draft.get("content", ""),
        "status":      "draft",
    }

    if dry_run:
        log(f"  [DRY RUN] Would insert blog_posts: {row['title'][:60]}")
        post_id = "dry-run-blog"
    else:
        post_id = sb_insert(sb_url, sb_key, "blog_posts", row)
        if not post_id:
            log("  [ERROR] blog_posts insert failed")
            return
        log(f"  Inserted: {post_id[:8]} | {row['title'][:50]}")

    # ── Step 5: WhatsApp notification ─────────────────────────────────────
    log("Step 5: WhatsApp to Dominic")

    msg = (
        f"✍️ Blog draft ready for review\n"
        f"Title: {row['title']}\n"
        f"Category: {row['category']} | {row['read_time']}\n"
        f"Excerpt: {row['excerpt'][:100]}\n\n"
        f"Review in Mission Control → Blog section.\n"
        f"Publish when ready."
    )

    if dry_run:
        log(f"  [DRY RUN] WhatsApp:\n{msg}")
    else:
        whatsapp(msg)

    log(f"[BLOG] Pipeline complete — draft '{row['title']}' in blog_posts (status=draft)")

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="DC81 Content Pipeline")
    parser.add_argument("--type", choices=["social", "blog"], required=True)
    parser.add_argument("--topic", required=True)
    parser.add_argument("--platforms", help="social only: comma-separated (x,linkedin,facebook)")
    parser.add_argument("--content-type", dest="content_type",
                        choices=["blog_share", "tip", "stat", "announcement", "quote"],
                        help="social only: post format")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    creds  = load_creds(SUPABASE_CREDS)
    sb_url = creds.get("DC81_SUPABASE_URL", "").rstrip("/")
    sb_key = creds.get("DC81_SUPABASE_ANON_KEY", "")
    if not args.dry_run and (not sb_url or not sb_key):
        die("Missing Supabase credentials")

    if args.type == "social":
        if not args.platforms:
            die("--platforms required for social pipeline")
        if not args.content_type:
            die("--content-type required for social pipeline")
        platforms = [p.strip().lower() for p in args.platforms.split(",")]
        run_social_pipeline(args.topic, platforms, args.content_type,
                            args.dry_run, sb_url, sb_key)
    else:
        run_blog_pipeline(args.topic, args.dry_run, sb_url, sb_key)


if __name__ == "__main__":
    main()
