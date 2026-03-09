# Monetization Model

*Last updated: March 2026*

This document defines the monetization variables, their initial values, rationale, and measurement plan. All values are designed to be tunable. The goal at this stage is **activated users and traction**, not revenue.

---

## Philosophy

Job Finder targets job seekers who are income-constrained and time-limited (average active search: 2–5 months). The free tier must be genuinely useful — not a teaser. The donation model reduces friction vs. a hard paywall while capturing real willingness-to-pay signal. Every variable is a hypothesis; the measurement plan defines when and why to adjust.

---

## Tiers

| Tier | Cost | Runs/Month | Jobs in DB | How to Unlock |
|---|---|---|---|---|
| **Free** | $0 | 10 | 500 | Default |
| **Supporter** | Donate ≥ $5 | 40 | 2,000 | One-time donation per period |
| **Unlimited** | $9/month or $79/year | Unlimited | Unlimited | Subscription |
| **Free Forever** | $0 | Unlimited | Unlimited | See below |

---

## Variable Definitions

### Free Tier

```js
FREE_RUNS_PER_MONTH = 10
// Full pipeline executions per calendar month.
// "Run" = npm run run or dashboard Run All.
// NOTE: "run" is an internal/technical label. UI should display a
// friendlier term — candidates: "refreshes", "syncs", "searches".
// Decide before public launch; the label shapes how users perceive the limit.
//
// Rationale: generous for launch — covers roughly every 3 days,
// accommodating active job seekers without feeling restrictive.
// Goal at this stage is activated users, not conversion pressure.
// Watch: if median free user hits limit before day 20, increase to 15.
// If <30% of free users ever hit the limit, consider reducing to 7
// to create more meaningful upgrade pressure.

FREE_JOBS_IN_DB = 500
// Total active (non-archived) jobs allowed in local database.
// Secondary limit — serves two purposes:
// (1) Natural upgrade path as pipeline grows
// (2) Abuse/cost hedge: prevents runaway DB growth from automated misuse
// Rationale: a real shortlist rarely exceeds 200; 500 gives genuine
// headroom while creating light pressure to archive or manage data.
// This limit should be invisible to most casual users and only felt
// by power users or those running many sources.
// NOTE: auto-deletion (see below) keeps this limit from being silently
// hit by dead listings. Without it, the cap fills with stale data
// and punishes users for the wrong reason.
// Watch: if users frequently report hitting this before the run limit,
// raise to 1,000 or decouple tracking entirely.
```

### Storage Retention (Auto-Delete)

```js
AUTO_DELETE_ENABLED_DEFAULT = true
// Auto-delete is ON by default.
// Rationale: job postings go stale fast. Indeed free posts expire in 30 days;
// LinkedIn free posts expire in 21 days; 43% of roles are filled within 30 days.
// Default-on keeps the DB clean without user configuration, and prevents the
// free-tier jobs-in-DB cap from filling with dead listings rather than live pipeline.
// The right default-on test: does this serve the user even if they never touch it?
// For stale job data, clearly yes.

AUTO_DELETE_TTL_NEW_DAYS = 30
// Jobs with status "new" (never viewed) auto-delete after 30 days.
// Aligns with Indeed/LinkedIn free post expiration window.
// These listings are almost certainly filled or expired by this point.

AUTO_DELETE_TTL_VIEWED_DAYS = 45
// Jobs the user has opened/viewed auto-delete after 45 days.
// Extra runway since user showed intent; gives time to reconsider.

AUTO_DELETE_TTL_SKIP_FOR_NOW_DAYS = 21
// Jobs marked "skip for now" auto-delete after 21 days.
// If a user deferred and hasn't returned in 3 weeks, they won't.
// Aligns with LinkedIn free post duration.

AUTO_DELETE_TTL_REJECTED_DAYS = 14
// Jobs marked "rejected" auto-delete after 14 days.
// Decision is made; no reason to retain.

AUTO_DELETE_TTL_APPLIED = null
// Applied jobs are NEVER auto-deleted.
// Application history is a core user artifact — preserve unconditionally.
// Future: expose as exportable record.

// Watch: track how often users manually disable auto-delete.
// If >20% disable it, the TTLs may be too aggressive.
// If users frequently complain about losing jobs they wanted to revisit,
// add a "protect this job" pin feature before adjusting TTLs.
```

### Donation Unlock (Supporter Tier)

```js
DONATION_MINIMUM_USD = 5
// Minimum donation to unlock Supporter tier.
// "Any amount" creates $0.01 noise that pollutes conversion data.
// $5 is accessible for job seekers and signals genuine intent.
// Watch: if <10% of users who see the donation prompt complete it,
// consider dropping to $3. If >40% complete, test raising to $8.

DONATION_UNLOCK_PERIOD_DAYS = 30
// How long a single donation unlocks Supporter tier.
// Monthly aligns with job search cadence and creates recurring
// donation behavior without requiring subscription infrastructure.
// Watch: what % of Supporters re-donate after 30 days?
// If <20%, consider extending to 60 days to build habit first.

SUPPORTER_RUNS_PER_MONTH = 40
// Run limit for Supporter tier.
// Rationale: 4x the free tier — a meaningful, felt difference.
// Covers daily use across most source configurations.
// The gap between free (10) and supporter (40) should feel like
// a genuine unlock, not a token improvement.
// Watch: if Supporters consistently hit this limit, raise to 60
// or remove the cap entirely for donors.

SUPPORTER_JOBS_IN_DB = 2000
// Jobs-in-DB limit for Supporter tier.
// Effectively unlimited for most job searches.
```

### Subscription (Unlimited Tier)

```js
SUBSCRIPTION_MONTHLY_USD = 9
// Monthly subscription price.
// Rationale: below all comparable tools (Teal $29, Jobright $39.99,
// Jobscan $49). Appropriate for pre-PMF stage. Job seekers are
// income-constrained; $9 is below psychological resistance.
// Watch: if monthly conversion exceeds 8% of active users,
// test raising to $12. If <1% after 60 days, investigate whether
// price or value is the blocker.

SUBSCRIPTION_ANNUAL_USD = 79
// Annual subscription price (~$6.58/month, saves 27% vs monthly).
// Rationale: most job searches don't last a full year, so annual
// will underperform monthly. Keep it available but don't promote
// it heavily at this stage.
// Watch: if annual:monthly ratio exceeds 30%, it signals users
// with longer search horizons — re-evaluate annual price.

SUBSCRIPTION_TRIAL_DAYS = 0
// Free trial days before subscription charges.
// Rationale: the free tier IS the trial. Avoid trial-to-paid
// infrastructure complexity at this stage. Revisit if conversion
// data suggests trial would help.
```

### Free Forever Paths

```js
FREE_FOREVER_CONDITIONS = [
  "github_star",       // Star the repo. Lowest friction, signals community support.
  "refer_paying",      // Refer 2 users who donate or subscribe. Growth mechanic.
  "contributor",       // Merged PR or meaningful issue contribution.
  "power_user_cohort"  // Invited by maintainer. For early adopters and feedback partners.
]
// Rationale: free forever paths create evangelists, not just users.
// Each path is a different kind of community signal.
// "github_star" is the highest-volume path and also the most valuable
// for social proof early on.
// Watch: track which path most Free Forever users came through.
// Over-index on whichever produces the most active, referring users.
```

---

## Measurement Plan

Track these metrics per variable. Review at 30, 60, and 90 days.

| Variable | Signal to Watch | Adjustment Trigger |
|---|---|---|
| `FREE_RUNS_PER_MONTH` | % of free users hitting limit; median day-of-month when hit | <30% ever hit limit → reduce to 7; median hit before day 20 → increase to 15 |
| `FREE_JOBS_IN_DB` | % of free users hitting job limit | >30% hit this before run limit → make unlimited |
| `AUTO_DELETE_TTL_*` | % of users who disable auto-delete; complaints about lost jobs | >20% disable → TTLs too aggressive; add pin feature if revisit complaints spike |
| `DONATION_MINIMUM_USD` | Donation prompt → completion rate | <10% complete → drop to $3; >40% → test $8 |
| `DONATION_UNLOCK_PERIOD_DAYS` | Re-donation rate after 30 days | <20% re-donate → extend to 60 days |
| `SUBSCRIPTION_MONTHLY_USD` | Free → paid conversion rate | >8% → test $12; <1% after 60 days → investigate value blocker |
| `FREE_FOREVER_CONDITIONS` | Which path drives most active/referring users | Double down on highest-signal path |

---

## Competitive Context

| Tool | Free Tier | Paid |
|---|---|---|
| Teal | Unlimited tracker, limited AI credits | $29/month |
| Jobright AI | Daily credit limits | $39.99/month |
| Jobscan | Limited scans/month | $49/month |
| **Job Finder** | **10 runs/month, 500 jobs** | **$9/month** |

Job Finder is priced 3–5× below comparable tools at launch. This is intentional: traction > revenue at this stage. Raise prices when retention data justifies it.

---

## Update Log

| Date | Change | Rationale |
|---|---|---|
| 2026-03-08 | Initial values set | Pre-launch baseline |
| 2026-03-08 | FREE_RUNS_PER_MONTH: 3 → 10; SUPPORTER_RUNS_PER_MONTH: 15 → 40 | Launch generosity: optimize for activated users, not conversion pressure |
| 2026-03-08 | Added storage retention variables; AUTO_DELETE_ENABLED_DEFAULT = true | Status-aware TTLs aligned with platform expiration data; applied jobs never deleted |
