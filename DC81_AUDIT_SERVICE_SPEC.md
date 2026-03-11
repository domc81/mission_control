# DC81 Digital Presence Audit Service — Master Spec
**Status:** Approved for build  
**Last updated:** 2026-03-11  
**Agreed by:** Dominic Clauzel

---

## Architecture Overview

```
Zone 1: dc81.io (Next.js, public-facing)
  /digital-audit          — Lead capture form (SEO-optimised)
  /audit/pending/[job-id] — Waiting page (polls job status)
  /audit/report/[id]      — Report render page (SSR from Supabase)

Zone 2: Audit Engine (Docker on Hetzner via Coolify, internal)
  Python service: POST /scan → runs all checks → writes to Supabase
  Redis (Docker): BullMQ job queue + progress tracking
  Crawl4AI: site crawl, directory checks, social signals
  PageSpeed Insights API: Lighthouse + Core Web Vitals
  Google Places API: GBP completeness scoring

Zone 3: Agent Layer (OpenClaw, internal, Tier 2 only)
  Triggered manually by Cestra after client engagement + payment
  Agents: ORIN (competitors + citations), Vision (keywords + content gaps),
          VEDA (authority assessment), Loki (report writing), Kyra (QA)
```

---

## Supabase Schema (New Tables)

### audit_jobs
```sql
id            UUID PK DEFAULT uuid_generate_v4()
lead_id       UUID FK leads(id)
status        TEXT  -- queued | running | complete | failed
progress      JSONB -- { step: 'crawl', pct: 40, message: 'Crawling site...' }
created_at    TIMESTAMPTZ DEFAULT NOW()
completed_at  TIMESTAMPTZ
error_message TEXT
```

### audit_reports
```sql
id            UUID PK DEFAULT uuid_generate_v4()
job_id        UUID FK audit_jobs(id)
lead_id       UUID FK leads(id)
tier          INTEGER  -- 1 | 2
report_json   JSONB    -- full structured findings
overall_score INTEGER  -- 0-100
created_at    TIMESTAMPTZ DEFAULT NOW()
access_type   TEXT DEFAULT 'public'  -- public | private
```

### audit_competitors (Tier 2)
```sql
id            UUID PK DEFAULT uuid_generate_v4()
report_id     UUID FK audit_reports(id)
competitor_name TEXT
website       TEXT
findings_json JSONB
created_at    TIMESTAMPTZ DEFAULT NOW()
```

### leads table additions (extend existing)
New columns to add:
- audit_keywords TEXT[]   -- submitted keywords
- audit_gbp_name TEXT     -- Google Business Profile name as submitted
- audit_location  TEXT    -- target location/postcode
- social_handles  JSONB   -- { twitter, instagram, facebook, linkedin }
- pipeline_stage  TEXT DEFAULT 'new'  -- new | audit_sent | nurture | qualified | client | closed

---

## Tier 1 Scan Worker

### Tech stack
- Python 3.12
- FastAPI (single endpoint: POST /scan)
- Crawl4AI (site crawl + social/directory checks)
- BullMQ via Python bullmq library (job queue)
- Redis 7 (Docker, Coolify)
- httpx + BeautifulSoup4 (direct HTTP checks)
- Google PageSpeed Insights API (free, 25k/day)
- Google Places API (Text Search + Place Details Basic SKU, ~1p/audit)
- Resend (email delivery)

### Checks performed

#### SEO / Technical
- [ ] Broken internal links (Crawl4AI)
- [ ] Missing/duplicate meta titles and descriptions
- [ ] Heading structure (missing H1, multiple H1s, skipped levels)
- [ ] Redirect chains (3xx) and redirect loops
- [ ] Canonical tag presence and correctness
- [ ] SSL/HTTPS validation (cert valid, no mixed content)
- [ ] robots.txt: exists, parseable, not blocking Googlebot
- [ ] robots.txt: AI crawler access (GPTBot, Anthropic-AI, PerplexityBot, ClaudeBot)
- [ ] sitemap.xml: exists, parseable, submitted URLs reachable
- [ ] Schema.org structured data: LocalBusiness schema present and valid
- [ ] Mobile usability (via PageSpeed mobile score)

#### Performance
- [ ] Lighthouse Performance score (mobile + desktop)
- [ ] Lighthouse Accessibility score
- [ ] Lighthouse SEO score
- [ ] Lighthouse Best Practices score
- [ ] LCP (Largest Contentful Paint)
- [ ] INP (Interaction to Next Paint)
- [ ] CLS (Cumulative Layout Shift)

#### Google Business Profile
- [ ] Business found via Places API Text Search
- [ ] Address completeness
- [ ] Phone number present
- [ ] Website URL matches submitted domain
- [ ] Opening hours set
- [ ] Business category set
- [ ] Photos present (count)
- [ ] Review count
- [ ] Average rating
- [ ] Reviews responded to (response rate signal)

#### Social Media (public signals only)
- [ ] Facebook profile exists
- [ ] Instagram profile exists
- [ ] LinkedIn company page exists
- [ ] X/Twitter profile exists
- [ ] Last post date (dormancy check — if accessible publicly)
- [ ] Visible follower count (where public)

### Scoring

Each check produces: { status: 'red'|'amber'|'green', value: any, message: string }

Overall score (0-100): weighted average
- Technical/SEO: 35%
- Performance: 30%
- GBP: 25%
- Social: 10%

### Report JSON structure
```json
{
  "lead_id": "uuid",
  "domain": "example.co.uk",
  "scanned_at": "ISO8601",
  "overall_score": 67,
  "overall_rag": "amber",
  "sections": {
    "technical": { "score": 72, "rag": "amber", "checks": [...] },
    "performance": { "score": 45, "rag": "red", "checks": [...] },
    "gbp": { "score": 80, "rag": "green", "checks": [...] },
    "social": { "score": 60, "rag": "amber", "checks": [...] }
  },
  "top_issues": [...],  // top 5 red findings, prioritised
  "ai_aeo": {
    "robots_blocks_ai": false,
    "blocked_crawlers": []
  }
}
```

---

## Tier 2 Agent Workflow

### Trigger
Cestra receives instruction from Dominic: "Run Tier 2 for [lead_id]"
Cestra fetches Tier 1 report JSON from Supabase as baseline.

### Agent assignments

| Agent | Task | Output |
|-------|------|--------|
| ORIN | Competitor research: identify top 5 local competitors for client's keywords+location via web search. Crawl each with Crawl4AI. Check GBP via Places API. | `competitors.json` per competitor |
| Vision | Keyword + content gap analysis: what topics rank locally that client is invisible for. What content competitors publish that client doesn't. | `content_gaps.json` |
| VEDA | Link authority assessment: domain age, sector directory presence, press mentions, industry body references. Qualitative authority vs competitors. GSC access request flag. | `authority_assessment.json` |
| ORIN (pass 2) | NAP/citation consistency: check business name, address, phone across top 20 UK directories using Crawl4AI. Flag inconsistencies. | `citation_audit.json` |
| Loki | Report writing: narrative analysis, prioritised action plan table (issue → severity → fix → effort hours → time to impact → DIY cost estimate → professional cost estimate), executive summary. | `report_narrative.md` |
| Kyra | QA: fact-check against raw data, no fabricated stats, correct business name, tone compliance, section completeness. | `qa_review.json` + approved flag |
| Cestra | Assemble final report. Write to Supabase (tier=2, access_type=private). Notify Dominic. | Report URL |

### UK directories for citation audit (top 20)
Yell, Thomson Local, FreeIndex, Yelp UK, Cylex, 192.com, Scoot, Bing Places,
Apple Maps, Facebook, Google Business Profile, Foursquare, HotFrog, TouchLocal,
Brownbook, Bark.com, Rated People (if applicable), TrustATrader (if applicable),
Checkatrade (if applicable), local Chamber of Commerce

---

## Lead Nurture Email Sequence (Resend)

| Email | Timing | Subject | Content |
|-------|--------|---------|---------|
| #1 | Immediate | Your DC81 audit is ready | Report link. Top 3 findings personalised. No pitch. |
| #2 | Day 2 | Why [top issue] is costing you leads | Deep explanation of their #1 critical finding in plain English. No pitch. |
| #3 | Day 5 | How [similar business] fixed this | Real/scenario case study matching their problem type. No pitch. |
| #4 | Day 9 | The full picture — what the free audit can't tell you | First mention of Tier 2 paid service. Clear scope, clear price, book a call CTA. |
| #5 | Day 14 | Quick check-in | Short human follow-up. Any questions? No pitch. |
| #6 | Day 21 | [Relevant insight matching their findings] | Value-add content. Keeps them in ecosystem. |
| Re-engage | Quarterly | Time for a re-audit? | Free re-audit offer. Re-enters funnel. |

### High-intent signals (Cestra monitors + flags to Dominic)
- Report page opened 3+ times
- Any email reply
- CTA click (book a call)

---

## Build Sequence

### Phase 1 — Foundation (Week 1)
1. Supabase migration: new tables + leads table additions
2. Redis Docker container via Coolify
3. Audit Engine skeleton: FastAPI + BullMQ worker + basic job lifecycle

### Phase 2 — Core Checks (Week 1-2)
4. PageSpeed Insights API integration
5. Direct HTTP checks (SSL, robots, sitemap, schema detection)
6. Google Places API integration + GBP scoring

### Phase 3 — Crawl layer (Week 2)
7. Crawl4AI integration: site crawl for SEO checks
8. Social existence + dormancy checks
9. Scoring engine: RAG mapping + weighted overall score

### Phase 4 — dc81.io frontend (Week 2-3)
10. /digital-audit lead capture page (SEO-optimised)
11. /audit/pending/[job-id] polling page
12. /audit/report/[id] report render page
13. Report page design (branded, mobile-responsive, print-friendly)

### Phase 5 — Email + nurture (Week 3)
14. Resend integration + 6 email templates
15. Trigger logic: email #1 on report complete, sequence scheduled

### Phase 6 — Tier 2 agent playbooks (Week 4+)
16. ORIN competitor research workflow
17. Vision content gap workflow
18. VEDA authority assessment workflow
19. ORIN citation audit workflow
20. Loki report writing workflow
21. Kyra QA workflow
22. Cestra assembly + delivery

---

## Open Questions (deferred)
- Pricing for Tier 2 service (Dominic to decide)
- Whether to offer Ahrefs one-off ($99/month) for clients with budget — decision at delivery time
- CRM platform: leads currently go to Supabase. Full CRM UI is a separate future project.
- GSC access request: build into Tier 2 onboarding flow

---

## Infrastructure
- Hetzner EX44: i5-13500, 64GB RAM, 1TB NVMe
- Coolify: Docker deployments
- Redis 7: new Docker container
- Audit Engine: new Docker container (Python 3.12)
- dc81.io: Next.js 16, existing Coolify deployment
- Supabase: existing DC81 instance
- Resend: existing account

