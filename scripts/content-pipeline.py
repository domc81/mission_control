#!/usr/bin/env python3
"""
content-pipeline.py — DC81 Autonomous Content Pipeline
One call = one post for one platform at one scheduled time.

Called by content-scheduler.py — not by humans.

SOCIAL:
  Vision research (first run of the day only, cached) →
  Loki writes platform-native copy (angle: lead/angle_2/angle_3) →
  Kyra reviews →
  render_card() if applicable →
  INSERT social_posts with scheduled_for →
  WhatsApp approval batch (collected by scheduler, sent once per day)

BLOG:
  Vision research → Loki full post → Kyra review →
  INSERT blog_posts (status=draft) → WhatsApp notify

Platform copy guidelines baked into Loki briefs:
  X:         Punchy, opinionated, ≤240 chars. No hashtags. No links. Sounds like a person.
  LinkedIn:  Professional insight, 120-260 words, one point, CTA, 3-5 hashtags at end.
  Instagram: Caption for the card image. 1-3 sentences. 1 emoji max. 5-8 hashtags, new line.
  Facebook:  Friendly, conversational, slightly longer than X. Can include link.
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

WORKSPACE      = "/root/.openclaw/workspace-cestra"
LOG_FILE       = f"{WORKSPACE}/logs/content-pipeline.log"
SUPABASE_CREDS = "/root/.dc81-supabase-credentials"
WHATSAPP_TO    = "+447377541121"

CARD_TEMPLATES = {
    "tip":          "tip-insight-card",
    "stat":         "stat-fact-card",
    "announcement": "announcement-card",
    "quote":        "quote-share-card",
    "blog_share":   "blog-share-card",
}

DC81_VOICE_RULES = """DC81 VOICE — apply to every word:
- Write as Dominic Clauzel, first person. "I" not "we" unless referring to DC81 the company.
- No em dashes (—). Full stops, commas, colons, semicolons, or parentheses only.
- No exclamation marks.
- No invented statistics. Only real, citable UK data (ONS, FSB, BCC, Deloitte UK, KPMG UK, UK national press).
- No "In today's..." or "In the ever-evolving..." openers.
- Banned words: synergy, game-changer, leverage, cutting-edge, innovative solutions, disrupt, unlock, empower (generic), deep dive, ecosystem (products)
- Tone: 28-year business veteran talking directly to other UK business owners. No hype.
- Every post must pass: "Would a real person engage with this or scroll past?"
"""

PLATFORM_COPY_GUIDE = {
    "x": """X/Twitter copy rules:
- MAX 240 characters — count carefully before outputting.
- Voice: punchy, direct, slightly opinionated. Like a sharp observation at a business event.
- No hashtags. No links. No "thread below" nonsense.
- Start with the point — no wind-up. "The briefing" tone, not "thought leadership".
- Different angle to LinkedIn — this is conversational, not professional.
- Examples of good X copy: "Most business websites are just expensive brochures. 
  No CTA, no tracking, no follow-up. Your sales team wouldn't operate like that."
""",
    "linkedin": """LinkedIn copy rules:
- 120-260 words. One clear point. No meandering.
- Professional but direct — Dominic writing to peers, not broadcasting.
- Structure: hook → insight → evidence (real stat or observation) → takeaway.
- End with a genuine question or CTA (not "what do you think?").
- 3-5 relevant hashtags on the LAST LINE only — never inline.
- No link in post body. Put it in the first comment field.
""",
    "instagram": """Instagram caption rules:
- 1-3 short sentences. The card image does the heavy visual lifting — your job is the hook.
- Max 1 emoji, used naturally.
- Hashtags on a SEPARATE line at the end. 5-8 tags relevant to UK business/AI/digital.
- Conversational, not corporate.
- Example: "Most websites don't generate leads. Not because of the design — because 
  there's nothing driving traffic to them.\n\n#ukbusiness #smallbusiness #digitalmarketing #ai #dc81"
""",
    "facebook": """Facebook copy rules:
- Slightly longer than X, more conversational.
- Friendly, slightly informal. Dominic talking to business owners in a Facebook group.
- Can include the DC81 link. CTA at end.
- No hashtags or keep to 1-2 max.
""",
}

ANGLE_GUIDE = {
    "lead":    "This is the PRIMARY post for this topic. Make it the strongest hook — the stat, the claim, or the insight that makes people stop.",
    "angle_2": "This is the SECOND post on this topic today. Take a DIFFERENT angle. If the first post stated a problem, this one offers a solution or contrarian take. Do NOT repeat the same hook.",
    "angle_3": "This is the THIRD post on this topic today (X only). Go DEEPER — a specific example, a short story, or a question that challenges the reader. Must feel fresh vs the first two posts.",
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
# Agent messaging
# ---------------------------------------------------------------------------

def agent_send(agent_id: str, message: str, timeout: int = 180) -> bool:
    try:
        result = subprocess.run(
            ["openclaw", "agent", "--agent", agent_id, "--message", message],
            capture_output=True, text=True, timeout=timeout
        )
        if result.returncode == 0:
            log(f"  → {agent_id}: delivered")
            return True
        else:
            log(f"  [WARN] {agent_id}: rc={result.returncode} {result.stderr[:100]}")
            return False
    except subprocess.TimeoutExpired:
        log(f"  [WARN] {agent_id}: timed out")
        return False
    except Exception as e:
        log(f"  [WARN] {agent_id}: {e}")
        return False

# ---------------------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------------------

def sb_insert(sb_url: str, sb_key: str, table: str, row: dict) -> str | None:
    data = json.dumps(row).encode()
    req = urllib.request.Request(
        f"{sb_url}/rest/v1/{table}", data=data,
        headers={
            "apikey": sb_key, "Authorization": f"Bearer {sb_key}",
            "Content-Type": "application/json", "Prefer": "return=representation",
        }, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())[0]["id"]
    except Exception as e:
        log(f"  [ERROR] Supabase INSERT {table}: {e}")
        return None

def sb_patch(sb_url: str, sb_key: str, table: str, row_id: str, patch: dict):
    data = json.dumps(patch).encode()
    req = urllib.request.Request(
        f"{sb_url}/rest/v1/{table}?id=eq.{row_id}", data=data,
        headers={
            "apikey": sb_key, "Authorization": f"Bearer {sb_key}",
            "Content-Type": "application/json",
        }, method="PATCH"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception as e:
        log(f"  [WARN] Supabase PATCH {table}: {e}")

# ---------------------------------------------------------------------------
# WhatsApp
# ---------------------------------------------------------------------------

def whatsapp(msg: str):
    try:
        result = subprocess.run(
            ["openclaw", "message", "send",
             "--channel", "whatsapp", "--to", WHATSAPP_TO, "--message", msg],
            capture_output=True, text=True, timeout=20
        )
        if result.returncode != 0:
            log(f"  [WARN] WhatsApp: {result.stderr[:100]}")
    except Exception as e:
        log(f"  [WARN] WhatsApp: {e}")

# ---------------------------------------------------------------------------
# File wait
# ---------------------------------------------------------------------------

def wait_for_file(path: str, max_wait: int = 120) -> bool:
    for _ in range(max_wait // 5):
        if Path(path).exists() and Path(path).stat().st_size > 20:
            return True
        time.sleep(5)
    return False

# ---------------------------------------------------------------------------
# Card rendering
# ---------------------------------------------------------------------------

def render_card(post_type: str, topic: str, copy_text: str, dry_run: bool) -> str:
    template = CARD_TEMPLATES.get(post_type)
    if not template:
        return ""

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug  = "".join(c if c.isalnum() or c == "-" else "-"
                    for c in topic.lower().replace(" ", "-"))[:30].strip("-")

    if post_type == "tip":
        words, lines, cur = copy_text.split(), [], []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 38:
                lines.append(" ".join(cur[:-1])); cur = [w]
                if len(lines) == 4: break
        if cur and len(lines) < 4: lines.append(" ".join(cur))
        while len(lines) < 4: lines.append("")
        vars_ = {"TIP_LINE_1": lines[0][:40], "TIP_LINE_2": lines[1][:40],
                 "TIP_LINE_3": lines[2][:40], "TIP_LINE_4": lines[3][:40], "TAG": "DC81"}
    elif post_type == "stat":
        vars_ = {"STAT": topic[:30], "CAPTION_LINE_1": copy_text[:55],
                 "CAPTION_LINE_2": "", "SOURCE": "DC81 Research"}
    elif post_type == "announcement":
        vars_ = {"HEADLINE_LINE_1": topic[:40], "HEADLINE_LINE_2": "",
                 "SUBTEXT_LINE_1": copy_text[:55], "SUBTEXT_LINE_2": ""}
    elif post_type == "quote":
        words, lines, cur = copy_text.split(), [], []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 38:
                lines.append(" ".join(cur[:-1])); cur = [w]
                if len(lines) == 4: break
        if cur and len(lines) < 4: lines.append(" ".join(cur))
        while len(lines) < 4: lines.append("")
        vars_ = {"QUOTE_LINE_1": lines[0][:40], "QUOTE_LINE_2": lines[1][:40],
                 "QUOTE_LINE_3": lines[2][:40], "QUOTE_LINE_4": lines[3][:40],
                 "AUTHOR": "Dominic Clauzel", "SOURCE": "DC81"}
    elif post_type == "blog_share":
        vars_ = {"CATEGORY": "DC81", "CATEGORY_WIDTH": "80",
                 "TITLE_LINE_1": topic[:40], "TITLE_LINE_2": "", "TITLE_LINE_3": "",
                 "DATE": datetime.now(timezone.utc).strftime("%-d %B %Y"), "READ_TIME": "5 min read"}
    else:
        return ""

    if dry_run:
        log(f"  [DRY RUN] Would render {template}")
        return "https://example.com/dry-run-card.png"

    log(f"  Rendering {template}")
    try:
        r = subprocess.run(
            ["python3", f"{WORKSPACE}/scripts/render-card.py",
             "--template", template, "--vars", json.dumps(vars_),
             "--slug", slug, "--date", today],
            capture_output=True, text=True, timeout=60
        )
        if r.returncode == 0:
            url = r.stdout.strip()
            log(f"  Card: {url}")
            return url
        log(f"  [WARN] Card failed: {r.stderr[-150:]}")
        return ""
    except Exception as e:
        log(f"  [WARN] Card exception: {e}")
        return ""

# ---------------------------------------------------------------------------
# SOCIAL PIPELINE
# ---------------------------------------------------------------------------

def run_social_pipeline(topic: str, platform: str, post_type: str, angle: str,
                        scheduled_for: str, content_mix_type: str,
                        dry_run: bool, sb_url: str, sb_key: str):

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug  = "".join(c if c.isalnum() or c == "-" else "-"
                    for c in topic.lower().replace(" ", "-"))[:40].strip("-")

    log(f"[SOCIAL] {platform} | {angle} | {scheduled_for} | {topic[:50]}")

    # ── Step 1: Vision research (cached per topic per day) ─────────────────
    research_file = f"{WORKSPACE}/cache/research-{today}-{slug}.md"
    os.makedirs(f"{WORKSPACE}/cache", exist_ok=True)

    if not Path(research_file).exists():
        log("Step 1: Vision research")
        brief = f"""DC81 content research.

Topic: {topic}

Find and write to: {research_file}

1. 2-3 real, citable UK statistics (ONS, FSB, BCC, Deloitte UK, KPMG UK, UK national press)
2. Core pain point for UK SME owners
3. Any relevant news in the last 6 months

Factual only. Short markdown. Save file. Reply DONE."""

        if not dry_run:
            sent = agent_send("vision", brief, timeout=150)
            if sent:
                wait_for_file(research_file, max_wait=120)
    else:
        log("Step 1: Vision research (cached)")

    research_context = f"\nResearch available at: {research_file}\n" if Path(research_file).exists() else ""

    # ── Step 2: Loki — platform-native copy ────────────────────────────────
    copy_file = f"{WORKSPACE}/cache/copy-{today}-{slug}-{platform}-{angle}.json"
    log(f"Step 2: Loki copy ({platform}/{angle})")

    loki_brief = f"""DC81 copywriting task.

Topic: {topic}
Platform: {platform.upper()}
Angle: {angle}
{research_context}
{DC81_VOICE_RULES}

{PLATFORM_COPY_GUIDE.get(platform, '')}

Angle guidance:
{ANGLE_GUIDE.get(angle, 'Write the best version of this topic for this platform.')}

Write ONLY the copy for {platform.upper()}. Nothing else.
Output JSON to: {copy_file}

Format:
{{"copy": "the post text here", "first_comment": "DC81 link if LinkedIn, else null"}}

Save file. Reply DONE."""

    copy_text = ""
    first_comment = ""

    if not dry_run:
        sent = agent_send("loki", loki_brief, timeout=180)
        if sent and wait_for_file(copy_file, max_wait=150):
            try:
                with open(copy_file) as f:
                    data = json.load(f)
                copy_text     = data.get("copy", "")
                first_comment = data.get("first_comment") or ""
                log(f"  Copy: {copy_text[:60]}...")
            except Exception as e:
                log(f"  [ERROR] Copy file parse: {e}")
        if not copy_text:
            log("  Loki copy not ready — aborting this post")
            return
    else:
        copy_text     = f"[DRY RUN {platform}/{angle}] {topic[:60]}"
        first_comment = "https://dc81.io/services/ai-agents" if platform == "linkedin" else ""

    # ── Step 3: Kyra review ────────────────────────────────────────────────
    review_file = f"{WORKSPACE}/cache/review-{today}-{slug}-{platform}-{angle}.json"
    log("Step 3: Kyra review")

    kyra_brief = f"""DC81 copy review.

Platform: {platform.upper()}
Copy: {copy_text}

{DC81_VOICE_RULES}

Check:
- Char count for X: must be ≤240
- No banned words
- No invented stats
- Tone matches platform guide

Output JSON to: {review_file}
Format: {{"copy": "approved or corrected text", "first_comment": "{first_comment}"}}
Save file. Reply DONE."""

    if not dry_run:
        sent = agent_send("kyra", kyra_brief, timeout=120)
        if sent and wait_for_file(review_file, max_wait=90):
            try:
                with open(review_file) as f:
                    data = json.load(f)
                copy_text     = data.get("copy", copy_text)
                first_comment = data.get("first_comment") or first_comment
            except Exception:
                pass  # Use Loki copy as-is

    # ── Step 4: Render card ─────────────────────────────────────────────────
    log("Step 4: Card")
    card_url = ""
    needs_card = platform in ("instagram", "facebook") or post_type in ("stat", "tip", "quote", "announcement")

    if needs_card:
        card_url = render_card(post_type, topic, copy_text, dry_run)

    if platform == "instagram" and not card_url:
        log("  Instagram requires card — skipping (card render failed)")
        return

    # ── Step 5: Insert to social_posts ─────────────────────────────────────
    log("Step 5: Supabase INSERT")

    row = {
        "platform":      platform,
        "content":       copy_text,
        "status":        "pending_approval",
        "content_type":  content_mix_type,
        "scheduled_for": scheduled_for,
    }
    if card_url and platform in ("instagram", "facebook"):
        row["media_urls"] = [card_url]

    if dry_run:
        log(f"  [DRY RUN] Would insert: {platform} | sched={scheduled_for} | {copy_text[:60]}")
        post_id = f"dry-run-{platform}-{angle}"
    else:
        post_id = sb_insert(sb_url, sb_key, "social_posts", row)
        if not post_id:
            log("  Insert failed")
            return
        log(f"  Inserted: {post_id[:8]}")

    # ── Step 6: WhatsApp approval message ──────────────────────────────────
    log("Step 6: WhatsApp")

    # Format scheduled time in UK local for readability
    try:
        sched_dt = datetime.fromisoformat(scheduled_for.replace("Z", "+00:00"))
        sched_display = sched_dt.strftime("%H:%M UTC")
    except Exception:
        sched_display = scheduled_for

    card_line = f"\nCard: {card_url}" if card_url else ""

    msg = (
        f"📝 {platform.upper()} post ready\n"
        f"Slot: {sched_display} | Type: {post_type} ({content_mix_type})"
        f"{card_line}\n\n"
        f"{copy_text}\n\n"
        f"ID: {post_id[:8] if not dry_run else post_id}\n"
        f"Reply: APPROVE {post_id[:8] if not dry_run else post_id} or REJECT {post_id[:8] if not dry_run else post_id} <reason>"
    )

    if dry_run:
        log(f"  [DRY RUN] WhatsApp:\n{msg}")
    else:
        whatsapp(msg)

    log(f"[SOCIAL] Done — {platform} {angle} queued for {scheduled_for}")

# ---------------------------------------------------------------------------
# BLOG PIPELINE
# ---------------------------------------------------------------------------

def run_blog_pipeline(topic: str, dry_run: bool, sb_url: str, sb_key: str):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug  = "".join(c if c.isalnum() or c == "-" else "" for c in
                    topic.lower().replace(" ", "-"))[:50].strip("-")
    os.makedirs(f"{WORKSPACE}/cache", exist_ok=True)

    log(f"[BLOG] {topic!r}")

    # Vision research
    research_file = f"{WORKSPACE}/cache/blog-research-{today}-{slug}.md"
    log("Step 1: Vision research")
    if not Path(research_file).exists() and not dry_run:
        brief = f"""DC81 blog research.

Topic: {topic}
Write to: {research_file}

Find: 3-5 real UK stats, common SME objections/misconceptions, 3-4 subtopics worth covering, relevant case studies.
Factual only. Save file. Reply DONE."""
        agent_send("vision", brief, timeout=150)
        wait_for_file(research_file, max_wait=120)

    research_context = f"\nResearch: {research_file}\n" if Path(research_file).exists() else ""

    # Loki blog draft
    draft_file = f"{WORKSPACE}/cache/blog-{today}-{slug}.json"
    log("Step 2: Loki blog draft")

    loki_brief = f"""DC81 blog post.

Topic: {topic}
{research_context}
{DC81_VOICE_RULES}

Write a full blog post for dc81.io:
- 800-1200 words
- Author: Dominic Clauzel
- Audience: UK small business owners
- Structure: engaging intro → 3-4 substantive sections → conclusion with CTA
- Tone: direct, practical — business owner talking to peers
- No bullet-point walls
- CTA: relevant DC81 service page

Output JSON to: {draft_file}
{{
  "slug": "url-slug",
  "title": "Title",
  "excerpt": "1-2 sentence excerpt",
  "category": "AI|Tech|Business|SEO|Web",
  "meta_title": "≤60 chars",
  "meta_desc": "≤155 chars",
  "read_time": "N min read",
  "keywords": ["kw1","kw2","kw3"],
  "service_link": "/services/...",
  "hero_icon": "Brain",
  "content": "full markdown"
}}
Save file. Reply DONE."""

    blog_draft: dict = {}
    if not dry_run:
        sent = agent_send("loki", loki_brief, timeout=300)
        if sent and wait_for_file(draft_file, max_wait=240):
            try:
                with open(draft_file) as f:
                    blog_draft = json.load(f)
            except Exception as e:
                log(f"  [ERROR] Draft parse: {e}"); return
        if not blog_draft:
            log("  Draft not ready — aborting"); return
    else:
        blog_draft = {"slug": slug, "title": f"[DRY RUN] {topic}",
                      "excerpt": "dry run", "category": "AI",
                      "meta_title": topic[:60], "meta_desc": topic[:155],
                      "read_time": "5 min read", "keywords": [],
                      "service_link": "/contact", "hero_icon": "Brain",
                      "content": "[DRY RUN]"}

    # Kyra review
    review_file = f"{WORKSPACE}/cache/blog-review-{today}-{slug}.json"
    log("Step 3: Kyra review")
    if not dry_run:
        brief = f"""DC81 blog review.

{DC81_VOICE_RULES}

Draft: {json.dumps(blog_draft, indent=2)[:3000]}

Check all voice rules. Fix issues. Output corrected JSON to: {review_file}
Same format. Save file. Reply DONE."""
        sent = agent_send("kyra", brief, timeout=120)
        if sent and wait_for_file(review_file, max_wait=90):
            try:
                with open(review_file) as f:
                    blog_draft = json.load(f)
            except Exception:
                pass

    # Insert blog_posts
    log("Step 4: Supabase INSERT")
    row = {
        "slug": blog_draft.get("slug", slug),
        "title": blog_draft.get("title", topic),
        "date": today, "category": blog_draft.get("category", "AI"),
        "excerpt": blog_draft.get("excerpt", ""),
        "meta_title": blog_draft.get("meta_title", topic[:60]),
        "meta_desc": blog_draft.get("meta_desc", ""),
        "read_time": blog_draft.get("read_time", "5 min read"),
        "keywords": blog_draft.get("keywords", []),
        "service_link": blog_draft.get("service_link", "/contact"),
        "author": "Dominic Clauzel",
        "hero_icon": blog_draft.get("hero_icon", "Brain"),
        "content": blog_draft.get("content", ""),
        "status": "draft",
    }

    if dry_run:
        log(f"  [DRY RUN] Would insert blog: {row['title'][:60]}")
    else:
        post_id = sb_insert(sb_url, sb_key, "blog_posts", row)
        if not post_id:
            log("  Insert failed"); return
        log(f"  Inserted: {post_id[:8]} | {row['title'][:50]}")

    log("Step 5: WhatsApp")
    msg = (f"✍️ Blog draft ready\nTitle: {row['title']}\n"
           f"Category: {row['category']} | {row['read_time']}\n"
           f"Excerpt: {row['excerpt'][:100]}\n\nReview in MC → Blog section.")
    if dry_run:
        log(f"  [DRY RUN] WhatsApp:\n{msg}")
    else:
        whatsapp(msg)

    log(f"[BLOG] Done — '{row['title']}' in blog_posts (draft)")

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--type",              choices=["social", "blog"], required=True)
    parser.add_argument("--topic",             required=True)
    # Social args
    parser.add_argument("--platform",          help="single platform: x|linkedin|instagram|facebook")
    parser.add_argument("--content-type",      dest="post_type",
                        choices=["blog_share","tip","stat","announcement","quote"])
    parser.add_argument("--angle",             default="lead",
                        choices=["lead","angle_2","angle_3"])
    parser.add_argument("--scheduled-for",     dest="scheduled_for", default=None,
                        help="ISO8601 UTC e.g. 2026-03-14T09:30:00Z")
    parser.add_argument("--content-mix-type",  dest="content_mix_type",
                        choices=["curated","original","personal"], default="original")
    parser.add_argument("--dry-run",           action="store_true")
    args = parser.parse_args()

    creds  = load_creds(SUPABASE_CREDS)
    sb_url = creds.get("DC81_SUPABASE_URL", "").rstrip("/")
    sb_key = creds.get("DC81_SUPABASE_ANON_KEY", "")
    if not args.dry_run and (not sb_url or not sb_key):
        die("Missing Supabase credentials")

    if args.type == "social":
        if not args.platform:
            die("--platform required for social")
        if not args.post_type:
            die("--content-type required for social")
        run_social_pipeline(
            topic           = args.topic,
            platform        = args.platform,
            post_type       = args.post_type,
            angle           = args.angle,
            scheduled_for   = args.scheduled_for or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            content_mix_type= args.content_mix_type,
            dry_run         = args.dry_run,
            sb_url          = sb_url,
            sb_key          = sb_key,
        )
    else:
        run_blog_pipeline(args.topic, args.dry_run, sb_url, sb_key)


if __name__ == "__main__":
    main()
