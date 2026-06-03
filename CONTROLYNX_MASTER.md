# CONTROLYNX — Master Architecture & Product Blueprint
> **Single source of truth. Read this before building anything.**
> Last updated: June 2026 | Version: 2.1

---

## 1. COMPANY DEFINITION

### Vision
Every construction project in the world controlled in real time.

### Mission
Replace manual reporting with intelligent project controls — so engineers spend their time analysing, not formatting.

### One-line positioning
*"Controlynx is the AI project controls platform that turns daily site data into decisions — before delays become disputes."*

### Core values
- **Accuracy first** — AI assists, human reviews and approves. Never auto-submit to client.
- **Built by practitioners** — 22 years on site. Every feature solves a real problem.
- **Radical simplicity** — Site engineer fills DPR in 5 minutes. Always. No exceptions.

---

## 2. THE FUNDAMENTAL ARCHITECTURE PRINCIPLE

> **The DPR is not a report. It is the data collection engine.**

Every AI feature, every dashboard, every report, every delay analysis, every claim — is downstream of structured daily data entered through the DPR. This is why DPR quality and adoption is the #1 priority above everything else.

```
Site Engineer (5 min)
    → Structured DPR Form (11 tabs, role-separated)
        → Supabase Database (real-time sync)
            → Reporting Intelligence  (PDF/Word/Excel/PPT)
            → Schedule Intelligence   (P vs A, SPI, S-curve)
            → Risk Intelligence       (early warning, alerts)
            → Productivity Intelligence (manpower, CPI)
            → Claims Intelligence     (EOT narrative, forensic)
```

**Rule:** Never build a feature that bypasses the DPR data layer. Every input must go through the structured form.

---

## 3. PRODUCT MODULES — FULL ECOSYSTEM

### Phase 1 (Must have — build now)
| Module | Purpose | Status |
|--------|---------|--------|
| DPR Form | 11-tab structured daily data collection | ✅ Built |
| Multi-user sync | Supabase real-time, role-separated | ✅ Built |
| Auth flow | Signup → setup → DPR | ✅ Built |
| P6 XER upload | Parse Primavera activities into DB | ✅ Done |
| PDF generation | Client-format external report (Puppeteer) | ⏳ Next |
| AI narrative | Internal 4-section summary (Claude API) | ⏳ Next |
| Email dispatch | Auto-email to distribution list (Resend) | ⏳ Next |
| Weekly P6 export | Activity % complete export for P6 update | ⏳ Next |

### Phase 2 (Should have — months 3–6)
| Module | Purpose | Depends on |
|--------|---------|-----------|
| Delay intelligence | Flag critical path risks before they become claims | DPR history + P6 baseline |
| Planned vs actual dashboard | SPI, float, S-curve, live project health | P6 upload + daily DPR |
| Manpower histogram | Planned vs actual headcount by trade | Labour tab data |
| Risk register | Auto-populated from issues log trends | Issues tab data |
| Stripe billing | Plan enforcement, upgrades, webhooks | Auth + org model |

### Phase 3 (Future — months 6–18)
| Module | Purpose | Depends on |
|--------|---------|-----------|
| Claims intelligence | EOT narrative from structured DPR history | 6+ months of DPR data |
| Cost intelligence | EVM (CPI/SPI), cost forecast | Labour + productivity data |
| Portfolio dashboard | Multi-project health scores for PMO/directors | Multiple projects |
| Document intelligence | RFI/submittal tracking with programme impact | Engineering tab data |
| Procurement tracking | Material delivery vs programme | Materials tab data |
| BIM integration | Link 3D model to activities | Enterprise only |
| Mobile PWA | Install to home screen, offline mode | Phase 1 complete |

---

## 4. DATABASE SCHEMA — LOCKED STRUCTURE

> **Do not change table names or core columns without updating this document first.**

```sql
-- Core tables (all RLS disabled, protected by server JWT auth)
organizations     -- id, name, plan, max_projects, max_users, stripe_id, is_active
profiles          -- id, full_name, role, organization_id, is_active
projects          -- id, name, client, pmc, consultant, contractor, contract_number,
                  -- start_date, planned_finish, report_prefix, site_lat, site_lng,
                  -- distribution_list (jsonb), subcontractors (jsonb), organization_id, is_active
project_members   -- project_id, user_id, role
daily_reports     -- id, project_id, organization_id, report_number, report_date, status,
                  -- [all 11 tab data columns as jsonb], ai_narrative, submitted_by, submitted_at
p6_activities     -- id, project_id, activity_id, description, wbs, planned_start,
                  -- planned_finish, duration, resource_name, imported_at

-- Planned future tables (do not build yet, but do not conflict with these names)
-- risk_register      -- project_id, raised_date, description, severity, owner, status
-- procurement_log    -- project_id, material, supplier, planned_delivery, actual_delivery
-- engineering_log    -- project_id, document_ref, type, submitted_date, approval_date, status
-- cost_items         -- project_id, wbs, planned_cost, actual_cost, earned_value
-- claims             -- project_id, type, event_date, description, days_claimed, status
```

### Data rules
- **Never store role in JWT only** — always read from `profiles.role` in DB
- **Organization is the billing unit** — one org per account, plan stored on org
- **Projects belong to org** — never to individual users
- **DPR data is append-only** — never delete a submitted report, only lock it
- **AI narrative is internal only** — never included in external PDF output

---

## 5. ROLE DEFINITIONS — LOCKED

> These roles control tab visibility, permissions, and data access. Never change without updating DPR UI.

| Role | DB value | Tabs visible | Can submit | Can create project |
|------|---------|-------------|-----------|-------------------|
| Planner / PCE | `planner` | All 11 tabs | Yes | Yes |
| Safety Engineer | `safety` | Safety tab only | No | No |
| Timekeeper | `timekeeper` | Labour tab only | No | No |
| Storekeeper | `storekeeper` | Materials tab only | No | No |
| Site Engineer | `engineer` | Activities tab only | No | No |
| QA/QC Engineer | `qa` | Issues tab only | No | No |
| Admin | `admin` | All 11 tabs | Yes | Yes |

---

## 6. DPR TABS — LOCKED STRUCTURE

> Tab order and names are fixed. Do not rename or reorder.

| # | Tab | Owner | External PDF | Internal AI |
|---|-----|-------|-------------|------------|
| 01 | Identity | Planner | ✅ Yes | ✅ Yes |
| 02 | Weather | Auto-fetch (GPS) | ✅ Yes | ✅ Yes |
| 03 | Safety | Safety Engineer | ✅ Yes | ✅ Yes |
| 04 | Labour | Timekeeper | ✅ Yes | ✅ Yes |
| 05 | Staffing | Planner | ✅ Yes | ✅ Yes |
| 06 | Equipment | Site Manager | ✅ Yes | ✅ Yes |
| 07 | Materials | Storekeeper | ✅ Yes | ✅ Yes |
| 08 | Activities | Site Engineer | ✅ Yes | ✅ Yes |
| 09 | Allocation | Planner | ❌ Never | ✅ Yes |
| 10 | Issues | QA/QC | ✅ Yes | ✅ Yes |
| 11 | Sign-off | Planner | ✅ Yes | ✅ Yes |

**Critical rule:** Allocation tab (09) is INTERNAL ONLY. It must never appear in the external client PDF. This is non-negotiable.

---

## 7. DUAL-OUTPUT ARCHITECTURE — NON-NEGOTIABLE

Every DPR submission produces two separate outputs:

```
DPR Submission
├── EXTERNAL PDF (client-mandated format)
│   ├── Uses client's report template
│   ├── Tabs 01-08, 10-11 only (no Allocation)
│   ├── No AI text visible
│   └── Emailed to distribution list by DC
│
└── INTERNAL AI NARRATIVE (internal use only)
    ├── Claude API generates 4-section analysis
    ├── Day Summary / Productivity / Issues & Risks / Tomorrow Readiness
    ├── Stored in daily_reports.ai_narrative
    └── Never emailed externally, never in client PDF
```

---

## 8. API ARCHITECTURE — SERVER.JS

> All database operations use the `db()` helper. Never bypass it.

```javascript
// Core principle: one helper, one key, all tables
async function db(method, table, opts = {})
// Uses SUPABASE_SERVICE_ROLE_KEY for all operations
// RLS disabled — server JWT validates user identity
// Never use supabase client for DB reads
```

### API routes (current)
```
POST /api/auth/signup     → Create auth user (trigger creates org+profile)
POST /api/auth/signin     → Login, returns JWT + profile
POST /api/auth/signout    → Logout
GET  /api/auth/me         → Current user + profile

GET  /api/projects        → List org projects
POST /api/projects        → Create project (planner/admin only)
GET  /api/projects/:id    → Single project
PATCH /api/projects/:id   → Update project

GET  /api/projects/:id/today     → Today's draft report (creates if missing)
GET  /api/projects/:id/reports   → Report history
GET  /api/reports/:id            → Single report
PATCH /api/reports/:id           → Auto-save draft
POST /api/reports/:id/submit     → Submit + trigger AI narrative
```

### Planned routes (do not conflict)
```
POST /api/projects/:id/p6/upload     → Upload XER file
GET  /api/projects/:id/p6/activities → List parsed activities
GET  /api/projects/:id/p6/export     → Weekly progress export for P6 update
POST /api/reports/:id/pdf            → Generate external PDF
GET  /api/projects/:id/dashboard     → Project health dashboard
GET  /api/projects/:id/risks         → Risk register
```

---

## 9. SUPABASE TRIGGER — DO NOT MODIFY

```sql
-- Fires on every new auth.users INSERT
-- Creates organization + profile automatically from user metadata
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

**Metadata stored during signup:**
- `full_name`, `role`, `org_name`, `plan`, `max_projects`, `max_users`

If this trigger is ever dropped or modified, the entire signup flow breaks.

---

## 10. TECH STACK — LOCKED

| Layer | Technology | Reason | Change trigger |
|-------|-----------|--------|---------------|
| Frontend | Vanilla HTML + JS | Fast iteration, no build step | When dashboard needs React |
| Backend | Node.js + Express | Simple, Vercel-compatible | At $50K MRR scale |
| Hosting | Vercel | Zero ops, auto-deploy from GitHub | Never |
| Database | Supabase (PostgreSQL) | Auth + DB + Storage in one | Never |
| AI | Claude Sonnet API | Best narrative quality | New Anthropic model release |
| PDF | Puppeteer | Renders HTML templates exactly | Phase 2 |
| Email | Resend API | Simple, affordable | Phase 2 |
| Payments | Stripe | Industry standard | Phase 3 |
| Storage | Supabase Storage | Already in stack | Phase 2 for photos |
| Weather | Open-Meteo API | Free, no key required | Never |
| Maps | OpenStreetMap/Leaflet | Free | Never |

---

## 11. ENVIRONMENT VARIABLES

```env
# Required — all must be set in Vercel production
SUPABASE_URL=https://zygnylsbmptucrgganjn.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...       # Public key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs... # Secret — longer than anon key
ANTHROPIC_API_KEY=sk-ant-...                       # Claude API for AI narrative

# Future (add before Phase 2/3)
RESEND_API_KEY=re_...        # Email dispatch
STRIPE_SECRET_KEY=sk_...     # Payments
STRIPE_WEBHOOK_SECRET=whsec_ # Stripe webhooks
```

---

## 12. FILE STRUCTURE — REPO

```
controlynx-dpr/
├── server.js              # Express backend — single source of backend logic
├── package.json
├── .env                   # Local only, never commit
├── landing.html           # Marketing landing page (root)
├── privacy.html
├── terms.html
├── security.html
└── public/
    ├── index.html         # DPR app (11 tabs) — 2988 lines
    ├── login.html         # Sign in page
    ├── signup.html        # 3-step account creation
    └── setup.html         # 5-step project setup wizard
```

---

## 13. REVENUE MODEL

| Plan | Price | Projects | Users |
|------|-------|---------|-------|
| Starter | $99/mo | 1 | 5 |
| Professional | $299/mo | 5 | 15 |
| Business | $799/mo | 15 | 50 |
| Enterprise | Custom ($2K+/mo) | Unlimited | Unlimited |

**Claims module:** Event-based pricing $5K–$50K per claim analysis (Phase 3+)

**Target milestones:**
- 10 customers → $3K MRR → proves product-market fit
- 50 customers → $15K MRR → seed round conversation
- 200 customers → $60K MRR → Series A ready

---

## 14. COMPETITOR GAPS — OUR DIFFERENTIATION

| We are better than | Why |
|-------------------|-----|
| Oracle Primavera P6 | P6 is for scheduling. We are for daily controls. P6 has no reporting, no AI, no daily input. |
| Procore | Procore is for document management. Our DPR is deeper. Our P6 integration is real. Procore costs $50K+/year. |
| Autodesk CC | Enterprise only. BIM-centric. No GCC focus. No daily reporting intelligence. |
| Deltek Acumen | Desktop app. Claims consultants only. No daily reporting. No site team input. |
| Excel + Word | The incumbent we are actually replacing. Free but costs 8 hours/week per engineer. |

**Our moat (in priority order):**
1. Structured daily data from site teams (competitors have no daily data)
2. Deep P6 integration that actually works for daily updates
3. GCC market expertise — terminology, contracts, workflows
4. Claims intelligence built on years of structured project history

---

## 15. BUILD RULES — FORWARD COMPATIBILITY

> Read before building any new feature.

### Database rules
- Always add new columns to existing tables rather than creating new tables when extending existing entities
- Never rename existing columns — add new ones
- jsonb columns for variable-length arrays (distribution_list, activities, etc.)
- All new tables must have: `id uuid DEFAULT uuid_generate_v4() PRIMARY KEY`, `created_at`, `organization_id` FK

### API rules
- All new routes go through `requireAuth` middleware
- All DB operations use the `db()` helper function
- Never expose service role key to client-side code
- Error responses always: `{ error: "message" }`
- Success responses always include the created/updated resource

### Frontend rules
- All pages use the same Controlynx design system: `#080D14` bg, `#00D4FF` cyan, Figtree/Syne/JetBrains Mono fonts
- CX diamond logo on every page header (not a star, not text-only)
- Role is always read from `localStorage.getItem('cx_user').role`
- Token is always `localStorage.getItem('cx_token')`
- Project is always `localStorage.getItem('cx_project')`
- No page should render without checking auth and redirecting if missing

### AI rules
- Claude API is internal only — output never goes to client without human review
- AI narrative is generated after submission, stored in DB, never blocks the submission flow
- All AI prompts must be grounded in structured data — no free-text hallucination risk
- AI generation errors are silent — report submits successfully even if AI fails

### Security rules (implement in Phase 4)
- Re-enable RLS with proper policies before any public launch with sensitive data
- Service role key only used server-side, never in client HTML
- Rate limiting on auth endpoints
- Session timeout after 8 hours of inactivity

---

## 16. CURRENT BUILD STATUS

### ✅ Complete
- Supabase schema (6 tables, trigger, RLS disabled)
- Express server.js with `db()` helper and `requireAuth` middleware
- DPR UI (11 tabs, 2988 lines, role enforcement, carry-forward)
- Login / signup / setup pages with proper CX logo
- Landing page with all CTAs wired to /signup and /login.html
- Multi-user real-time sync
- Supabase trigger for org+profile auto-creation
- Vercel deployment (controlynx.ai)
- Google Analytics (GA4)
- Wyoming LLC, domain, professional email, LinkedIn

### ⏳ Phase 2 — Build next (in order)
1. P6 XER file upload and activity parser
2. Cascading dropdowns in Activities tab from P6 data
3. Weekly P6 progress export (CSV/XER)
4. PDF report generation (Puppeteer, external client format)
5. Word (.docx) generation (docxtemplater)
6. Excel exports (labour register, activity log, equipment log)
7. AI narrative generation (Claude API, 4 sections, internal only)
8. Email dispatch (Resend API, PDF to distribution list)
9. Template upload engine (client maps their format once)

### 🔮 Phase 3 — After Phase 2 complete
1. Delay detection and early warning alerts
2. Planned vs actual dashboard (S-curve, SPI, float)
3. Manpower histogram planned vs actual
4. Risk register auto-population
5. Stripe integration and plan enforcement

### 🔭 Phase 4 — After Phase 3 complete
1. Report history and archive
2. Photo upload (Supabase Storage)
3. Portfolio dashboard (multi-project PMO view)
4. Claims intelligence module
5. Mobile PWA (manifest.json, offline mode)
6. Team invitations (email-based)
7. Security audit (RLS re-enable, rate limiting)

---

## 17. KNOWN TECHNICAL DEBT

| Issue | Impact | Fix in |
|-------|--------|--------|
| RLS disabled on all tables | Security risk with real customer data | Phase 4 |
| No rate limiting on auth routes | Brute force risk | Phase 4 |
| No session timeout | Security best practice | Phase 4 |
| No error monitoring (Sentry) | Blind to production errors | Phase 3 |
| No automated tests | Regressions catch up manually | Phase 3 |
| GA4 shows self-generated traffic | Analytics not reliable yet | Ongoing — use IP exclusion |

---

## 18. GO-TO-MARKET STRATEGY

### Immediate (now → 3 months)
- 5 free beta customers in GCC (UAE, KSA, Qatar)
- Target: active construction projects >$20M value
- Offer: free for 30 days, we set it up, they give feedback
- Success metric: engineer fills DPR daily without being reminded

### Traction phase (3–6 months)
- Convert 3 of 5 beta customers to paid
- LinkedIn content: 2 posts/week on project controls pain
- Target job titles: Planning Manager, PCM, Project Controls Engineer
- Case study: one real project, one real time saving

### Growth phase (6–18 months)
- 50 paying customers
- Partner with P6 training providers (they have the right audience)
- GCC construction association memberships
- Conference presence (Big 5, MEED Projects)

---

*This document is the architectural contract for Controlynx 2.0. Every feature, every database change, every API endpoint, every UI decision should be checked against this document before implementation. Update it when decisions change — never let code drift from this blueprint.*
