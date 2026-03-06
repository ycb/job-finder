# Job Finder: Product Analysis

**Analysis Date:** March 5, 2026
**Codebase Stats:** ~13,120 LOC (src), 48 passing tests, 26 commits since March 3, 2026
**Version:** 0.1.0 (pre-release)

---

## Executive Summary

Job Finder is a **local-first job search intelligence agent** that aggregates jobs from 8+ major platforms, deduplicates across sources, and ranks them against user-defined criteria. It's positioned as a daily-use CLI tool with a web dashboard for active job seekers who want systematic control over their search.

**Core differentiation:** Not a job board, not a scraper-as-a-service, but a **repeatable search system** with deterministic scoring, browser automation, and human-in-the-loop review.

**Current state:** Feature-complete MVP with production-ready architecture, but still in private development (not yet published to npm).

---

## Product Value Proposition

### What It Solves

**Primary pain points addressed:**

1. **Search fragmentation** - Job seekers manually check LinkedIn, Built In, Wellfound, Ashby, Indeed, ZipRecruiter, RemoteOK, Google separately
2. **Duplicate noise** - Same job appears across multiple platforms/searches with different formatting
3. **Manual triage overhead** - Hundreds of results require manual filtering for basic fit criteria
4. **Opaque ranking** - Job boards prioritize advertisers, not candidate fit
5. **Lost context** - No history of what you've applied to, rejected, or why

### Value Delivered

**Automated intelligence layer:**
- **Multi-source aggregation**: 8 platforms in one unified queue
- **Deduplication**: Cross-platform job matching via normalized company + external ID
- **Deterministic scoring**: Transparent ranking based on title, seniority, location, salary, company targets
- **Hard filtering**: Auto-reject based on excluded keywords, salary floors, work-type requirements
- **History-aware**: Adjusts scoring based on prior outcomes at company level
- **Application tracking**: Lightweight CRM for managing status (new/viewed/applied/skipped/rejected)

**Daily workflow efficiency:**
```bash
jf run      # 2-5 min: capture + sync + score + shortlist
jf review   # Opens ranked queue with top matches first
```

**Quantified value (estimated):**
- **Time saved**: 30-60 min/day (vs manual multi-platform searching)
- **Signal improvement**: 80%+ reduction in irrelevant results (hard filters + scoring)
- **Deduplication**: 20-40% fewer duplicate reviews (varies by search overlap)

### Target User

**Primary persona:** Individual job seeker with technical comfort (CLI acceptable)

**Best fit:**
- Active job search (daily/weekly use case)
- Searching across multiple platforms
- Values control, privacy, repeatability over convenience
- Comfortable with JSON config files and terminal commands
- Willing to invest 15-30 min in setup for ongoing efficiency gains

**Secondary persona:** Power users who want to extend/customize (e.g., custom source types, scoring tweaks)

---

## Product Readiness

### Strengths (Production-Ready Aspects)

**1. Architecture Quality (9/10)**
- Clean separation: config → sources → jobs → scoring → review
- Local SQLite with proper migrations (`addColumnIfMissing`)
- Deterministic, testable scoring (550 LOC with clear logic)
- 48 passing tests covering parsers, deduplication, hard filters, schema validation
- Zero external dependencies beyond Node 20+ standard library
- CLI + long-running dashboard server separation (no port conflicts)

**2. Multi-Source Coverage (8/10)**
- **Browser-capture sources (7):** LinkedIn, Wellfound, Ashby, Google, Indeed, ZipRecruiter, RemoteOK
- **HTTP-based sources (1):** Built In
- **Test sources (1):** mock_linkedin_saved_search
- **Extensible:** Clear pattern for adding new sources (see CLAUDE.md)

**3. Deduplication System (9/10)**
- `normalized_hash` from company + external_id + source_url
- Unique constraint on `(source_id, source_url)` prevents double-ingestion
- UI shows attribution (which sources surfaced each job)
- Regression tests ensure stability (test/normalize-dedupe.test.js)

**4. Configuration Flexibility (8/10)**
- **3 profile modes:** `legacy_profile`, `my_goals`, `narrata` (file/Supabase)
- **Global search criteria:** `config/search-criteria.json` with per-source overrides
- **Per-source tuning:** `cacheTtlHours`, `maxJobs`, `requiredTerms`, `searchCriteria`
- **URL normalization:** Auto-generates platform-specific URLs from canonical fields
- Dashboard UI for editing criteria without touching JSON

**5. Capture System (7/10)**
- **Auto-starting bridge:** Browser automation starts on-demand when needed
- **Multiple providers:** `chrome_applescript` (macOS default), `playwright_cli`, `persistent_scaffold`, `noop`
- **Cache TTL controls:** 12h (HTTP) / 24h (browser-capture) defaults, per-source overrides
- **Force refresh:** `--force-refresh` flag bypasses cache
- Snapshot fallback when live capture unavailable

**6. User Experience (7/10)**
- **Dashboard polish:** Clean 3-tab UI (Jobs/Searches/Profile) with prev/next navigation
- **Quick actions:** Mark applied/skip/reject from UI
- **Source quality metrics:** Jobs found, applied count, high signal %, avg score
- **Profile summary:** Active count, applied count at-a-glance
- **Fast feedback:** Dashboard updates reflect run results immediately

### Weaknesses (Gaps & Friction)

**1. Onboarding Complexity (5/10)**
- **Setup friction:** Requires manual config file copying and editing
- **No interactive init:** `jf init` only creates database, doesn't guide profile/source setup
- **Chrome setup:** Manual step to enable "Allow JavaScript from Apple Events"
- **Config schema learning curve:** 7 different config files (profile, my-goals, sources, search-criteria, profile-source, narrata config)
- **First-run confusion:** No sample data, empty dashboard until first successful `run`

**Mitigation in backlog:** P1 task to improve `jf init` with LinkedIn URL auto-extraction and prompted search params

**2. Platform Limitations (6/10)**
- **macOS-centric:** `chrome_applescript` provider is macOS-only; fallback providers less robust
- **Browser dependency:** 7/8 source types require browser automation (only Built In is HTTP-only)
- **Wellfound URL stubbing:** `searchCriteria` not yet applied to Wellfound (P0 backlog item)
- **No headless mode:** Browser capture requires visible Chrome window
- **Single-user only:** Local SQLite, no multi-user/team features

**3. Scoring Limitations (6/10)**
- **Deterministic-only:** No LLM-assisted ranking (by design, but limits ceiling)
- **Keyword-based hard filters:** Can miss nuanced job descriptions
- **No full JD analysis:** List/snippet text only; detail page fetch is P1 backlog
- **Limited company intelligence:** No funding, stage, tech stack enrichment
- **Manual profile maintenance:** User must update target companies, keywords manually

**4. Error Handling & Diagnostics (5/10)**
- **Silent failures:** Capture errors don't surface clearly in dashboard
- **No capture diagnostics persistence:** Unsupported criteria fields only visible in preview (P1 backlog)
- **Limited retry logic:** No exponential backoff for flaky captures
- **Minimal logging:** Console output, no structured log files
- **No health checks:** No way to verify bridge/source connectivity before full run

**5. Documentation Gaps (6/10)**
- **No video walkthrough:** Text-only install guide
- **No troubleshooting section:** Common errors (database locked, port conflicts) scattered
- **Example config quality:** Example files exist but lack inline comments
- **Architecture diagrams:** Text descriptions only, no visual system diagram
- **No changelog:** Version history not tracked in user-facing format

**6. Distribution & Deployment (4/10)**
- **Not published to npm:** Must clone repo and `npm link`
- **No releases:** Version 0.1.0 in package.json, no GitHub releases
- **No Docker option:** Requires local Node 20+ installation
- **No CI/CD:** Tests run locally only
- **Manual updates:** No `npm update` or auto-update mechanism

---

## Opportunities

### Short-Term (High Impact, Low Effort)

**1. Publish to npm (Impact: 9/10, Effort: 2/10)**
- **Value:** Removes git clone friction, enables `npx job-finder` trial flow
- **Action:** Publish as `@ycb/job-finder` or scoped package
- **Risk:** Low (MIT license, no external dependencies)

**2. Interactive `jf init` wizard (Impact: 8/10, Effort: 4/10)**
- **Value:** Reduces onboarding time from 30 min to 5 min
- **Action:** Prompt for profile basics, first LinkedIn URL, validate before save
- **Already in backlog:** P1 priority
- **Quick win:** Even basic prompts (name, title, location, salary) would help

**3. Dashboard capture diagnostics (Impact: 7/10, Effort: 3/10)**
- **Value:** Surfaces errors that currently fail silently
- **Action:** Persist `unsupported` criteria fields, capture errors, bridge status
- **Already in backlog:** P1 priority
- **Quick win:** Add "Last Run Status" badge to each source in Searches tab

**4. Add troubleshooting docs (Impact: 6/10, Effort: 2/10)**
- **Value:** Self-serve resolution for common issues (database locked, port conflicts)
- **Action:** Create `docs/troubleshooting.md` with solutions
- **Quick win:** Extract existing INSTALL.md troubleshooting into dedicated page

**5. GitHub releases with binaries (Impact: 7/10, Effort: 3/10)**
- **Value:** Enables non-technical users to download pre-built CLI
- **Action:** Use `pkg` or similar to bundle Node + code into macOS/Linux/Windows binaries
- **Risk:** Binary size (~50MB+), but one-time download

### Medium-Term (High Impact, Medium Effort)

**6. Full job description fetch + analysis (Impact: 9/10, Effort: 6/10)**
- **Value:** More accurate hard filtering, better scoring signals
- **Action:** Detail page fetch during ingestion, re-run keyword checks on full text
- **Already in backlog:** P1 priority
- **Challenge:** Adds latency to capture flow, requires per-platform detail parsers

**7. LLM-assisted scoring layer (Impact: 8/10, Effort: 7/10)**
- **Value:** Nuanced fit assessment beyond keyword matching
- **Action:** Optional Claude/GPT scoring mode alongside deterministic baseline
- **Design:** Keep deterministic as default, LLM as opt-in enhancement
- **Cost consideration:** Token costs for daily runs (mitigate with caching, batching)

**8. Greenhouse + Lever support (Impact: 7/10, Effort: 5/10)**
- **Value:** Expands coverage to company-specific ATS portals
- **Action:** Generalize Ashby portal abstraction for Greenhouse/Lever
- **Already in backlog:** P1 for Greenhouse
- **Opportunity:** Many high-growth companies use these ATSs exclusively

**9. Browser-free mode (Impact: 8/10, Effort: 8/10)**
- **Value:** Enables Docker deployment, headless servers, scheduled runs
- **Action:** Add HTTP-only parsers for LinkedIn, Indeed, etc. (may require API partnerships)
- **Risk:** Platform anti-scraping measures, rate limits, ToS concerns
- **Alternative:** Playwright headless mode (lighter than visible Chrome)

**10. Profile templates & sharing (Impact: 6/10, Effort: 4/10)**
- **Value:** Community-contributed profiles for common roles (PM, SWE, designer)
- **Action:** Add `jf profile import <url>` command, host templates in repo
- **Community leverage:** Users contribute their refined scoring criteria

### Long-Term (Strategic Shifts)

**11. Job Finder Cloud (Impact: 10/10, Effort: 10/10)**
- **Vision:** Hosted version with managed capture, no local setup
- **Value:** 10x more users (removes CLI/setup barrier)
- **Challenges:** Infrastructure costs, user auth, data privacy, ToS compliance
- **Business model:** Freemium (3 sources free, unlimited for $X/mo)
- **Risk:** Shifts from tool to service, changes value proposition

**12. Team/recruiter features (Impact: 7/10, Effort: 9/10)**
- **Vision:** Multi-user support, candidate pipelines, shared shortlists
- **Value:** Expands TAM to recruiting teams, hiring managers
- **Challenges:** Requires backend rewrite (SQLite → Postgres), auth, permissions
- **Business model:** Team pricing ($Y/user/mo)

**13. Application tracking + drafting (Impact: 8/10, Effort: 7/10)**
- **Vision:** LLM-generated cover letters, application form autofill
- **Value:** Closes the loop from search → apply in one tool
- **Design:** Pre-fill from profile, draft cover letter, track submission
- **Risk:** Feature creep (Job Finder becomes CRM+writing tool)
- **Opportunity:** Integrate with Narrata goals for personalized drafts

**14. Integrations ecosystem (Impact: 7/10, Effort: 8/10)**
- **Vision:** Export to Notion, Airtable, Google Sheets; webhook notifications
- **Value:** Fits into existing workflows, attracts power users
- **Examples:**
  - Slack notifications for high-signal jobs
  - Zapier integration for custom automations
  - API for building custom UIs

**15. Mobile companion app (Impact: 6/10, Effort: 10/10)**
- **Vision:** iOS/Android app for on-the-go review and quick apply
- **Value:** Enables passive browsing during commute, waiting time
- **Challenges:** Requires API layer, mobile dev resources, app store distribution
- **Risk:** Mobile-first users expect polish; CLI-first users don't need it

---

## Competitive Positioning

### Direct Competitors

**1. Job board aggregators (Aggregated, Indeed premium)**
- **Weakness:** Opaque ranking, ad-driven, no local control, no deduplication
- **Job Finder advantage:** Deterministic scoring, local-first, inspectable logic

**2. Job search CLIs (jobs-cli, linkedin-job-scraper)**
- **Weakness:** Single-platform, no scoring, no UI, no persistence
- **Job Finder advantage:** Multi-platform, scored queue, dashboard, SQLite history

**3. Generic scrapers (Apify, Scrapy)**
- **Weakness:** Developer tools, not end-user products, no job-search UX
- **Job Finder advantage:** Turnkey workflow, domain-specific features

**4. Job search CRMs (Huntr, JibberJobber)**
- **Weakness:** Manual job entry, no automated discovery, subscription fees
- **Job Finder advantage:** Automated intake, free/local, multi-source

### Indirect Competitors

**5. AI job search assistants (Simplify, LazyApply)**
- **Weakness:** Auto-apply without human review, quality control issues
- **Job Finder advantage:** Human-in-the-loop review, no blind submissions

**6. LinkedIn Premium / Job Board Premium**
- **Weakness:** Single platform, expensive ($40-120/mo), still requires manual triage
- **Job Finder advantage:** Multi-platform, free, automated triage

### Unique Position

**Job Finder occupies a niche:**
- **More automated** than manual job boards
- **More transparent** than AI assistants
- **More integrated** than single-platform scrapers
- **More privacy-focused** than cloud CRMs

**Positioning statement:**
*"Job Finder is the daily-use intelligence layer for serious job seekers who want systematic control over their multi-platform search."*

---

## Risk Assessment

### Technical Risks

**1. Platform anti-scraping measures (Medium)**
- **Risk:** LinkedIn, Indeed, etc. block or throttle automated access
- **Mitigation:** Browser automation mimics human behavior, cache reduces frequency
- **Contingency:** Fallback to snapshot import, API partnerships

**2. Browser automation brittleness (Medium)**
- **Risk:** UI changes break parsers, requiring frequent maintenance
- **Mitigation:** Tests catch parser failures, accessibility tree parsing is more stable than DOM
- **Contingency:** Community contributions for parser updates

**3. Database corruption (Low)**
- **Risk:** SQLite corruption from concurrent access, crashes
- **Mitigation:** Migrations run automatically, database is local (easy to recreate)
- **Contingency:** `jf init --reset` to rebuild from sources

### Business/Market Risks

**4. Narrow addressable market (Medium)**
- **Risk:** CLI + setup friction limits audience to tech-savvy job seekers
- **Mitigation:** NPM publish, better onboarding, GUI options (Electron, cloud)
- **Opportunity:** Even 1% of job seekers is large TAM

**5. Platform ToS violations (Low-Medium)**
- **Risk:** LinkedIn, Indeed ToS prohibit automated access
- **Mitigation:** Personal use clause, browser automation vs API abuse, local-only (no redistribution)
- **Contingency:** Legal review before commercialization, API partnerships

**6. Sustainability without monetization (Low)**
- **Risk:** Open source projects stagnate without funding
- **Mitigation:** MIT license enables commercial forks, low maintenance burden (no servers)
- **Opportunity:** Sponsorships, paid cloud tier, consulting

### User Risks

**7. Privacy concerns (Low)**
- **Risk:** Users wary of local data collection
- **Mitigation:** Local-first design, no telemetry, SQLite transparency
- **Strength:** Privacy is a competitive advantage vs cloud CRMs

**8. Time investment without ROI (Low-Medium)**
- **Risk:** Users invest in setup but don't land roles
- **Mitigation:** Clear value messaging (efficiency, not guarantees), quick wins (first run shortlist)
- **Reality:** Job search success is multifactorial; tool reduces friction but doesn't guarantee outcomes

---

## Recommendations

### Immediate (Next 2 weeks)

1. **Publish to npm** - Unlock `npx` trial flow, reduce clone friction
2. **Add troubleshooting docs** - Self-serve common issues
3. **Create GitHub release 0.1.0** - Signal readiness, enable binary downloads

### Short-term (Next 1-2 months)

4. **Ship interactive `jf init`** - Reduce onboarding from 30 min to 5 min
5. **Add dashboard capture diagnostics** - Surface silent failures
6. **Implement full JD fetch** - More accurate filtering/scoring
7. **Complete Wellfound criteria bootstrap** - Close P0 gap

### Medium-term (Next 3-6 months)

8. **Add LLM-assisted scoring** - Optional enhancement for nuanced fit
9. **Greenhouse + Lever support** - Expand ATS coverage
10. **Profile templates & sharing** - Community leverage
11. **Browser-free mode** - Enable Docker/headless deployments

### Strategic (6-12 months)

12. **Evaluate cloud offering** - Assess demand, business model viability
13. **Team features exploration** - Validate recruiter/hiring manager use cases
14. **Integrations ecosystem** - API, webhooks, Zapier

---

## Conclusion

**Job Finder is a production-ready MVP with strong technical foundations and clear product-market fit for power-user job seekers.**

**Key strengths:**
- Clean architecture, testable code, zero dependencies
- Multi-platform coverage (8 sources)
- Deterministic, transparent scoring
- Local-first privacy and control

**Key gaps:**
- Onboarding friction (manual setup, config complexity)
- Platform limitations (macOS-centric, browser-dependent)
- Silent failure modes (diagnostics needed)
- Not yet distributed (npm publish pending)

**Biggest opportunities:**
1. **NPM publish** → 10x user reach with minimal effort
2. **Interactive init** → Reduce bounce rate at onboarding
3. **Full JD fetch** → Higher scoring accuracy
4. **Cloud offering** → 100x TAM expansion (if demand validates)

**Recommended next step:**
**Ship 0.1.0 as public beta** (npm publish + GitHub release) and gather user feedback to validate demand before investing in cloud/team features.

The codebase is mature enough for public use; the question is market validation, not technical readiness.
