# DC81 Content Schedule

Last updated: 2026-03-10

## Posting Frequency
5 posts per week, Monday–Friday. No weekend posting.

## Platform Mix (weekly)
| Platform | Posts/week | Notes |
|----------|-----------|-------|
| X/Twitter | 5 | Every weekday. Text-only or text+image. |
| LinkedIn | 3 | Mon, Wed, Fri. Image or text. |
| Facebook | 2 | Tue, Thu. Adapted from LinkedIn or original. |
| Instagram | 1 | Wed only. MUST have image or video. Never text-only. |
| Google Business | 1 | Mon. Image or CTA post. |

## Content Mix (5-3-2 rule per 10 posts)
- **5 curated** — others' content with DC81 perspective. Quote cards or link shares.
- **3 original** — blog shares, tips, data, announcements.
- **2 personal** — real photos from Dominic. Ask via WhatsApp. No templates.

## Optimal Posting Times (UK, Europe/London)
| Platform | Best Times |
|----------|-----------|
| LinkedIn | 08:00–10:00 or 12:00–13:00 |
| X/Twitter | 08:00 or 17:00 |
| Facebook | 09:00 or 19:00 |
| Instagram | 11:00 or 19:00 |
| Google Business | 09:00 Monday |

## Approval Protocol
1. Cestra generates post via content-pipeline.py
2. WhatsApp sent to Dominic with: content, char count, platform, post ID, card image (if any)
3. Dominic replies: APPROVE <post_id> or REJECT <post_id> [reason]
4. approve-post.sh routes to correct posting script
5. **30-minute reminder:** if no response after 30 min, send one follow-up
6. **2-hour escalation:** if no response after 2 hours, move to next post in queue

## Engagement Check
- Run `late-inbox.py --mode all` daily at 09:00 UK time
- Comments with questions: Loki drafts reply, Cestra posts via Late API
- Negative reviews: flag to Dominic before replying
- DMs: summarise and send to Dominic — no auto-replies to DMs

## Card Templates
| Content Type | Template |
|-------------|---------|
| blog_share | blog-share-card.svg |
| tip | tip-insight-card.svg |
| stat | stat-fact-card.svg |
| announcement | announcement-card.svg |
| quote | quote-share-card.svg |

Render: python3 /root/.openclaw/workspace-cestra/scripts/render-card.py
Storage: social-media-assets Supabase bucket
Public URL: https://api-dc81.dc81.io/storage/v1/object/public/social-media-assets/{filename}

## DC81 Voice Rules (apply to every post)
1. First person as Dominic — "I" not "we" unless referring to DC81 the company
2. No em dashes — use full stops, commas, colons instead
3. No exclamation marks — maximum one per month
4. No invented statistics — research first or omit
5. No "In today's..." openings
6. No banned words: synergy, game-changer, leverage, cutting-edge, innovative solutions, disrupt, unlock, empower (generic), deep dive, ecosystem
7. Grounded tone — 28-year business veteran talking to other business owners

## Banned Words
synergy, game-changer, leverage, cutting-edge, innovative solutions, disrupt, unlock, empower (generic), deep dive, ecosystem (products)
