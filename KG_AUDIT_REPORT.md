# Knowledge Graph Audit Report
**Generated:** 2026-03-13  
**Author:** Cestra  
**Status:** Gap analysis only — no changes made

---

## Project Inventory

| Project Name (key) | Entities | Last Written |
|--------------------|----------|-------------|
| `mission_control` | 73 | 2026-02-28 |
| `DC81Website` | 59 | 2026-03-11 |

No other projects exist in the graph.

---

## 1. Mission Control (`mission_control`)

### What's In the Graph

**Last mapped:** 2026-02-28 (13 days ago)

#### Components (22)
UI Components:
- `App` — Main React component (ui/src/App.tsx)
- `KanbanBoard` — Task board (pending, in_progress, review, completed, archived columns)
- `DocumentsPanel` — Document listing and file upload
- `AgentConversationsPanel` — Agent message threads
- `TaskDetailPanel` — Task detail view
- `ConversationItem` — Individual conversation item

Infrastructure/System Entities (stored as Component type):
- `Mission Control App`, `Mission Control GitHub Repo`
- `Convex Backend`, `Coolify Host`, `Hostinger KVM2 VPS`, `DC81 Knowledge Graph API`

Agent Entities (stored as Component type):
- `Cestra`, `VEDA`, `ORIN`, `Vision`, `Loki`, `Fin`, `Architect`, `Koda`, `Kyra`

#### API Routes (14 — Convex mutations/queries)
`claimTask`, `completeTask`, `createDocument`, `getActivitiesFiltered`, `getAuditLog`, `getDashboard`, `getDocuments`, `getFileUrl`, `getMessages`, `getTasksByStatus`, `getTasksWithMessages`, `heartbeat`, `sendMessage`, `updateTaskStatus`

#### DB Functions (29 — full Convex function list)
`claimTask`, `completeTask`, `createDocument`, `deleteDocument`, `failTask`, `generateUploadUrl`, `getActivitiesFiltered`, `getAgents`, `getAuditLog`, `getDashboard`, `getDeadLetterQueue`, `getDocuments`, `getFileUrl`, `getMessages`, `getNotifications`, `getPendingTasksForAgent`, `getTaskById`, `getTasksByStatus`, `getTasksWithMessages`, `heartbeat`, `markNotificationDelivered`, `requestApproval`, `requeueDeadLetter`, `respondToApproval`, `sendMessage`, `updateDocument`, `updateTaskStatus`, `upsertAgent`, `writeTaskProgress`

#### DB Tables (8)
`activities`, `agents`, `auditLog`, `credentials`, `documents`, `messages`, `notifications`, `tasks`

#### Relationships
- `App` → CALLS → `createDocument`, `updateTaskStatus`, `getAuditLog`, `getDocuments`, `getActivitiesFiltered`, `getTasksByStatus`, `getDashboard`
- `DocumentsPanel` → CALLS → `getDocuments`
- `AgentConversationsPanel` → CALLS → `getTasksWithMessages`
- `KanbanBoard` — **no relationships recorded**

#### Decisions, Scripts, RLS Policies
**None recorded.**

---

### ⚠️ Gaps vs Current Codebase

The graph was last written **2026-02-28**. The repo has moved on significantly.

#### Stack Version Mismatch
| Item | Graph Says | Actual |
|------|-----------|--------|
| React | Not recorded | **19.2.4** |
| Vite | Not recorded | **7.3.1** |
| Convex | Not recorded | 1.3.1 |
| Build tool | Not recorded | Vite (not CRA) |

Stack versions are not recorded at all — the graph has no `Decision` entities for the tech stack.

#### Missing Components (exist in repo, not in graph)
- `GatewayBridge` — ui/src/GatewayBridge.tsx (OpenClaw gateway WebSocket bridge)
- `ContentPipeline` — ui/src/components/ContentPipeline.tsx (full content pipeline section)
- `CostTracking` — ui/src/components/CostTracking.tsx (cost tracking section)
- `useGateway` — ui/src/useGateway.ts (gateway hook)
- `gateway` lib — ui/src/lib/gateway.ts

#### Missing Nav Sections (7 sections in code, graph doesn't track nav structure)
Current nav: `overview`, `content`, `tasks`, `agents`, `costs`, `docs`, `audit`  
Graph records: none of these

#### Missing Supabase Connection
App.tsx has a direct Supabase connection (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) — not recorded in graph.

#### Missing proxy-server.cjs
`ui/proxy-server.cjs` exists (Express proxy server for production) — not in graph as a Script entity.

#### Missing Scripts (repo has many, none recorded)
`scripts/approve-post.sh`, `scripts/x-post.cjs`, `scripts/late-post.py`, `scripts/render-card.py`, `scripts/content-heartbeat.py`, `scripts/draft-x-post.cjs`, etc.

#### Missing Convex Functions (added since 2026-02-28)
- `addDocumentComment` — convex/addDocumentComment.ts
- `getDocumentComments` — convex/getDocumentComments.ts
- `createTask` — convex/createTask.ts (was missing from API Routes)

#### Missing Relationships
- `KanbanBoard` has zero relationships recorded
- `ContentPipeline` → calls to Convex not recorded
- `CostTracking` → calls not recorded
- No `App` → `GatewayBridge` / `ContentPipeline` / `CostTracking` dependencies

#### Summary
**Significantly out of date.** The graph reflects the state from 2026-02-28 before GatewayBridge, ContentPipeline, CostTracking, and the proxy-server were added. Stack versions unrecorded. No architectural decisions captured at all.

---

## 2. DC81 Website (`DC81Website`)

### What's In the Graph

**Last mapped:** 2026-03-11 (2 days ago)

#### Components (39)
Pages: `HomePage`, `AboutPage`, `BlogPage`, `BlogHeroBanner`, `CaseStudiesPage`, `ContactPage`, `NotFoundPage`, `PrivacyPage`, `ServicesPage`, `TermsPage`, `ThankYouPage`

Service Pages: `ServiceAIAgentsPage`, `ServiceAIConsultancyPage`, `ServiceAppDevelopmentPage`, `ServiceCustomWebAppsPage`, `ServiceSEOPage`, `ServiceWebsitesPage`

UI Sections: `FAQSection`, `FeaturesSection`, `FinalCTASection`, `FooterSection`, `HeroSection`, `HowItWorksSection`, `PricingSection`, `ProblemSolutionSection`, `TestimonialsSection`

Layout/Providers: `RootLayout`, `ClientProviders`, `LazyProviders`, `LandingNav`, `ServicePageLayout`

Utilities/Libs: `blogPostsData`, `leadsLib`, `supabaseClient`, `useMobile`, `useToast`, `utils`, `JsonLd`, `Turnstile`

#### API Routes (1)
- `notifyLead` — POST /api/notify-lead (validates Turnstile, saves to Supabase leads, sends email via nodemailer)

#### DB Tables (6)
`competitor_tracking`, `content_calendar`, `leads`, `organizations`, `profiles`, `user_roles`

#### DB Functions (5)
`get_user_organization_id`, `handle_new_user`, `handle_updated_at`, `has_role`, `is_super_admin`

#### Architectural Decisions (7)
- Next.js App Router — server components, metadata API, file-based routing
- Supabase for DB and Auth — auth, Postgres, RLS, real-time
- Multi-tenant Supabase schema — all tables org-scoped with RLS
- Tailwind + shadcn/ui — Radix UI primitives
- Cloudflare Turnstile CAPTCHA — privacy-friendly spam prevention
- Static blog data — posts in src/data/blogPosts.ts
- nodemailer for lead email — contact form notifications

#### Key Relationships Recorded
- `HomePage` → DEPENDS_ON → `HeroSection`, `FeaturesSection`, `PricingSection`, `TestimonialsSection`, `FAQSection`, `HowItWorksSection`, `ProblemSolutionSection`, `FinalCTASection`, `LandingNav`, `FooterSection`
- `ContactPage` → CALLS → `notifyLead`, DEPENDS_ON → `Turnstile`
- `RootLayout` → DEPENDS_ON → `JsonLd`, `LazyProviders`, `ClientProviders`
- `BlogPage` → DEPENDS_ON → `BlogHeroBanner`
- `notifyLead` → WRITES_TO → `leads`

---

### ⚠️ Gaps vs Current Codebase

#### Stack Version Mismatch
| Item | Graph Says | Actual |
|------|-----------|--------|
| Next.js | "14+" (decision text) | **16.1.6** |
| React | Not recorded | 18.3.1 |

#### Missing: Audit Engine (audit-engine/ directory)
Added 2026-03-11 — four files committed after the graph was mapped:
- `audit-engine/Dockerfile`
- `audit-engine/main.py` (FastAPI worker)
- `audit-engine/requirements.txt`
- `audit-engine/.dockerignore`

**Note:** Per the architectural decision made on 2026-03-11, the audit engine uses Supabase not Neo4j — so audit-engine entities were intentionally not added. This is correct behaviour. However the decision itself is not recorded in the graph.

#### Missing: RLS Policies
The graph has 0 RLS policies recorded despite the multi-tenant Supabase schema decision being active. These should exist for `leads`, `organizations`, `profiles`, `user_roles`.

#### Missing: Deployment/Script entities
- Coolify deployment (no Script entity for the Dockerfile or deployment config)
- No `Decision` for Coolify as hosting platform

#### Missing: Individual blog post relationships
`blogPostsData` exists as a component but no relationships to `BlogPage` or individual post components are recorded.

#### Summary
**Mostly current** for the website core (pages, components, DB, decisions). Two real gaps:
1. Next.js version in the decision text is wrong (says "14+" — actual is 16.1.6)
2. RLS policies entirely absent despite being architecturally significant
3. Audit engine decision not recorded (intentional omission of audit-engine code is correct)

---

## Overall Assessment

| Project | Status | Priority |
|---------|--------|----------|
| `mission_control` | 🔴 Significantly outdated — 13 days, 5+ missing components, no stack versions, no decisions | High |
| `DC81Website` | 🟡 Mostly current — 2 days old, minor gaps (RLS policies, version string) | Low-Medium |

**Recommendation:** Remap `mission_control` in full. Patch `DC81Website` for RLS policies and Next.js version string.
