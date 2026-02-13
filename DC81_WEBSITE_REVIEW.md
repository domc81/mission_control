# DC81 Website Review & Strategic Plan
**URL:** https://ops-nexus-hq.lovable.app  
**Review Date:** 2026-02-13 14:44 UTC  
**Reviewed By:** Cestra

---

## Website Overview

### Business Model
**Product:** AI Marketing Platform for Small Businesses  
**Core Value Prop:** Automate online presence with AI-powered competitor analysis, content creation, and lead nurturing

### Pricing Tiers
1. **Local Plan:** £29.99/mo — For local businesses (brick-and-mortar)
2. **Online Plan:** £99.99/mo — For e-commerce/online businesses

### Key Features Advertised
- Competitor analysis (track local/online competitors)
- AI-powered content creation
- Social media scheduling & automation
- Lead generation & nurturing
- Automated reporting

### Technical Stack
- **Platform:** Lovable (Supabase + React SPA)
- **Branding:** DC81 (matches company name)
- **Fonts:** Orbitron (headings) + Inter (body)
- **Theme Color:** #0ff0fc (cyan/electric blue)
- **Meta:** Full SEO setup (OG, Twitter Cards, Schema.org structured data)

### Social Presence Claimed
- Twitter: @dc81io
- LinkedIn: /company/dc81
- Instagram: @dc81io

---

## Current Squad Capabilities vs. Website Services

### ✅ What We Can Already Deliver (With Current Squad)

| Service | Agent Responsible | Status |
|---------|------------------|--------|
| **Competitor Analysis** | VEDA (Product Intelligence) | ✅ Ready (proven with Phase 2 analysis) |
| **Content Briefs** | Vision (SEO Intelligence) | ✅ Ready (needs first task) |
| **Content Writing** | Loki (Content Architect) | ✅ Ready (needs first task) |
| **Financial Tracking** | Fin (Finance & Revenue Ops) | ✅ Ready (4h heartbeat) |
| **Customer Research** | ORIN (Customer Research) | ✅ Ready (validation in progress) |

### 🔶 What We Need to Build (New Agents/Services)

| Service | Agent/Tool Needed | Priority | Notes |
|---------|------------------|----------|-------|
| **Social Media Scheduling** | Social Media Manager Agent | 🔴 HIGH | Need Make/Buffer/Hootsuite integration |
| **Lead Nurturing** | CRM/Automation Agent | 🔴 HIGH | HubSpot/ActiveCampaign integration |
| **Local SEO Tracking** | Local SEO Agent | 🟠 MEDIUM | Google My Business, local citations |
| **Reporting Dashboard** | Already building (Mission Control) | 🟢 LOW | Repurpose for client reporting |
| **Ad Campaign Management** | Ads Agent | 🟡 MEDIUM | Meta Ads, Google Ads automation |

---

## Strategic Phases (Next 90 Days)

### Phase 3: Service Delivery Infrastructure (Week 1-2)
**Goal:** Build the missing agents to deliver all advertised services

**New Agents to Spawn:**
1. **Social Media Manager (SMM)**
   - Role: Schedule, post, and monitor social media across platforms
   - Tools: Buffer/Hootsuite API, Make.com workflows
   - Heartbeat: Every 4h (check scheduled posts, engagement)

2. **Lead Nurture Agent (Luna)**
   - Role: CRM automation, email sequences, lead scoring
   - Tools: ActiveCampaign/HubSpot API, Airtable
   - Heartbeat: Every 6h (check new leads, trigger sequences)

3. **Local SEO Agent (Leo)**
   - Role: Track local rankings, manage GMB, citations
   - Tools: BrightLocal API, Google My Business API
   - Heartbeat: Every 12h (daily ranking checks)

**Tasks:**
- [ ] Define SOUL.md for each new agent
- [ ] Register agents via OpenClaw CLI
- [ ] Set up API integrations (Make.com, Buffer, ActiveCampaign)
- [ ] Build first workflows (e.g., "competitor post → our response")

---

### Phase 4: First Client Onboarding (Week 3-4)
**Goal:** Onboard first paying client (Local Plan £29.99/mo)

**Client Profile:**
- Local business (restaurant, clinic, or service centre you own)
- Needs: Competitor tracking, weekly social posts, monthly reports

**Deliverables:**
1. **Week 1:** Competitor audit (VEDA)
2. **Week 2:** Content calendar (Vision + Loki)
3. **Week 3:** Social media automation (SMM)
4. **Week 4:** Monthly report (Fin + Mission Control dashboard)

**Success Metrics:**
- ✅ Client receives weekly competitor insights
- ✅ 3 social posts/week auto-scheduled
- ✅ Monthly report delivered on time
- ✅ Client renews for Month 2

---

### Phase 5: Scale to 10 Clients (Week 5-12)
**Goal:** Onboard 10 clients (mix of Local + Online plans)

**Revenue Target:** £500-700/mo MRR
- 7 Local Plan clients @ £29.99 = £209.93
- 3 Online Plan clients @ £99.99 = £299.97
- **Total MRR:** £509.90

**Squad Scaling:**
- Each client gets dedicated competitor tracking (VEDA)
- Shared content production (Vision + Loki can handle 10 clients)
- Social automation runs 24/7 (SMM)
- Monthly reporting automated (Fin + Mission Control)

**Cost Management:**
- Track token burn per client (Fin monitors this)
- Optimize prompts to reduce API costs
- Use cheaper models for routine tasks (Gemini Flash Lite)

---

## Immediate Next Steps (This Week)

### 1. Create Today's Memory File
Document this review and plan:
```bash
echo "2026-02-13: Reviewed DC81 website, defined Phase 3-5 strategy" >> memory/2026-02-13.md
```

### 2. Spawn First New Agent (Social Media Manager)
- Create `/root/.openclaw/agents/smm/` directory
- Write SOUL.md (proactive, platform-native voice)
- Register via `openclaw agents add`
- Set heartbeat to 4h

### 3. Build First Client Workflow
- Use your restaurant as test client
- VEDA: Track 3 local competitors
- Loki: Write 3 sample social posts
- Vision: Create SEO brief for "best restaurant Jesmond"

### 4. Update WORKING.md
Track Phase 3 progress in main workspace

---

## Questions for Dominic

1. **Priority:** Which service should we build first? (Social scheduling vs. Lead nurture vs. Local SEO)
2. **Test Client:** Which of your businesses should be the first client? (Restaurant, Clinic, Tyre Centre?)
3. **Integrations:** Do you already have accounts with Buffer/Hootsuite/ActiveCampaign, or should we use Make.com for everything?
4. **Budget:** What's the monthly budget for API costs (OpenRouter, Make, etc.)?

---

## Revenue Path to £1M ARR

**Assumptions:**
- Average client value: £50/mo (mix of Local + Online)
- Client churn: 10%/mo (industry standard for SMB SaaS)
- Squad can handle 100 clients with current infrastructure

**Milestones:**
- **Month 1:** 1 client (£30 MRR)
- **Month 3:** 10 clients (£500 MRR)
- **Month 6:** 50 clients (£2,500 MRR)
- **Month 12:** 200 clients (£10,000 MRR = £120k ARR)
- **Month 24:** 1,667 clients (£83,350 MRR = £1M ARR)

**Critical Path:**
1. Perfect service delivery with first 10 clients (Months 1-3)
2. Build referral engine + case studies (Months 4-6)
3. Launch self-serve signup flow (Month 7)
4. Scale sales via paid ads (Months 8-12)
5. Build reseller/agency partnerships (Months 13-24)

---

**End of Review**
