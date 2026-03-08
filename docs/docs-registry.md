# Documentation Registry

As of 2026-03-08.

## Purpose

Canonical inventory of documentation artifacts, their audience, and update triggers.

## Registry

| Path | Audience | Purpose | Update Trigger |
| --- | --- | --- | --- |
| `README.md` | Users, evaluators | Product overview, workflow, command surface | Any user-visible behavior change |
| `INSTALL.md` | Users | Install/setup/run/troubleshooting | Setup or runtime workflow changes |
| `CLAUDE.md` | Contributors/agents | Architecture and development guidance | Architectural, workflow, or dev-policy changes |
| `AGENTS.md` | Contributors/agents | Repo agent instructions and skill routing | Agent workflow/process changes |
| `PROCESS.md` | Contributors | Process conventions and standards | Team process changes |
| `PLANS.md` | Contributors | Planning and execution meta guidance | Planning framework changes |
| `CHANGELOG.md` | Users, contributors | Durable chronological release/change history | Any release-significant change |
| `docs/documentation-protocol.md` | Contributors | Repeatable documentation governance protocol | Process changes to doc governance |
| `docs/docs-registry.md` | Contributors | Canonical inventory of docs and update triggers | Added/removed/repurposed docs |
| `docs/backlog.md` | Contributors | Prioritized work backlog and status | Backlog reprioritization |
| `docs/how-to.md` | Contributors/users | Operational/how-to playbook | Workflow execution changes |
| `docs/learnings.md` | Contributors | Captured lessons and retrospectives | Postmortems and notable insights |
| `docs/analysis/backlog-review.md` | Contributors | Analysis of backlog state and gaps | Backlog review refresh |
| `docs/analysis/product-analysis.md` | Contributors | Product-level analysis and recommendations | Product analysis refresh |
| `docs/analysis/2026-03-06-source-field-coverage-analysis.md` | Contributors | Baseline field-coverage analysis across sources | Coverage measurement refresh |
| `docs/analysis/source-contract-governance.md` | Contributors/operators | Governance model for source contracts and drift handling | Contract model/drift workflow changes |
| `docs/brand/BRAND_GUIDELINES.md` | Contributors/marketing | Brand voice and style rules | Brand direction updates |
| `docs/plans/2026-03-06-search-construction-design.md` | Contributors | Search construction design rationale | Superseding search design changes |
| `docs/plans/2026-03-06-caching-policy-execplan.md` | Contributors | Caching policy implementation plan | Caching strategy changes |
| `docs/plans/2026-03-06-linkedin-capture-depth-and-source-verification-execplan.md` | Contributors | LinkedIn capture depth/source verification plan | Capture-depth strategy changes |
| `docs/plans/2026-03-06-data-quality-epic-execplan.md` | Contributors | Data-quality epic execution plan | Data-quality strategy changes |
| `docs/plans/2026-03-07-adapter-reliability-guardrails-execplan.md` | Contributors/operators | Guardrails/canaries/source-health execution plan | Adapter reliability strategy changes |
| `docs/backlog-specs/completed-core-url-construction-rollout.md` | Contributors | Completed URL construction rollout record | Backfilled completion notes |
| `docs/backlog-specs/p0-source-capture-verification-framework.md` | Contributors | P0 source capture verification specification | Verification framework changes |
| `docs/backlog-specs/p0-source-full-jd-gap-closure.md` | Contributors | P0 source full-JD gap closure specification | Source extraction quality roadmap changes |
| `docs/backlog-specs/p1-core-formatter-diagnostics.md` | Contributors | Formatter diagnostics specification | Diagnostics feature changes |
| `docs/backlog-specs/p1-core-full-jd-pass.md` | Contributors | Full JD verification pass specification | JD verification scope changes |
| `docs/backlog-specs/p1-core-multi-keyword-comma.md` | Contributors | Multi-keyword parsing specification | Keyword parsing changes |
| `docs/backlog-specs/p1-core-net-new-refresh.md` | Contributors | Net-new + refresh incremental run behavior specification | Refresh UX/data lifecycle changes |
| `docs/backlog-specs/p1-core-search-hardfilter-keywords-include-exclude-cache.md` | Contributors | Search controls and hard-filter enhancement specification | Search UX/filter model changes |
| `docs/backlog-specs/p1-core-worktype-field.md` | Contributors | Work type field specification | Work type model changes |
| `docs/backlog-specs/p1-distribution-homebrew.md` | Contributors | Homebrew distribution specification | Packaging/distribution changes |
| `docs/backlog-specs/p1-distribution-npm-publish.md` | Contributors | NPM publish specification | Packaging/distribution changes |
| `docs/backlog-specs/p1-integrations-claude-skill.md` | Contributors | Claude skill integration specification | Skill integration changes |
| `docs/backlog-specs/p1-integrations-codex-mcp.md` | Contributors | Codex MCP integration specification | MCP integration changes |
| `docs/backlog-specs/p1-integrations-narrata.md` | Contributors | Narrata integration specification | Narrata integration changes |
| `docs/backlog-specs/p1-onboarding-jf-init.md` | Contributors | `jf init` onboarding specification | Onboarding/init behavior changes |
| `docs/backlog-specs/p1-onboarding-source-auth.md` | Contributors | Source auth onboarding specification | Source auth workflow changes |
| `docs/backlog-specs/p1-source-expansion-greenhouse.md` | Contributors | Greenhouse source expansion specification | Greenhouse roadmap changes |
| `docs/backlog-specs/p1-ux-multi-search-tabs.md` | Contributors | Multi-search tabs UX specification | Multi-context search UX changes |
| `docs/backlog-specs/p2-brand-styles.md` | Contributors | Brand style roadmap specification | Brand roadmap changes |
| `docs/backlog-specs/p2-source-expansion-levelsfyi.md` | Contributors | Levels.fyi source expansion specification | Levels.fyi roadmap changes |
| `docs/backlog-specs/p2-source-expansion-yc.md` | Contributors | YC source expansion specification | YC roadmap changes |
| `docs/backlog-specs/p2-source-quality-remoteok-validation.md` | Contributors | RemoteOK quality-validation specification | RemoteOK validation changes |
| `docs/backlog-specs/p2-source-quality-wellfound-bootstrap.md` | Contributors | Wellfound bootstrap quality specification | Wellfound bootstrap changes |
| `docs/backlog-specs/p2-ux-remove-searches-page.md` | Contributors | UX page-removal specification | UX roadmap changes |
| `docs/releases/RELEASE_NOTE_TEMPLATE.md` | Contributors | Standard release note structure | Release note format updates |
| `docs/releases/2026-03-06-refresh-policy-and-state.md` | Users, contributors | Dated release note for refresh policy/state foundation | Superseded by follow-up release notes or corrections |
| `docs/releases/2026-03-06-search-criteria-dashboard-and-ingestion.md` | Users, contributors | Dated release note for criteria-first scoring, dashboard flow, and ingestion hygiene updates | Superseded by follow-up release notes or corrections |
| `docs/releases/2026-03-08-source-quality-guardrails-and-contract-governance.md` | Users, contributors | Dated release note for source quality guardrails, canaries, and contract governance | Superseded by follow-up release notes or corrections |
| `docs/announcements/ANNOUNCEMENT_TEMPLATE.md` | Contributors/marketing | Standard LinkedIn/Substack post pack structure | Announcement format updates |
| `docs/announcements/2026-03-06-refresh-policy-and-state.md` | Marketing, founder narrative | Channel-ready launch narrative draft for 2026-03-06 release | Messaging refresh for this release |
| `docs/announcements/2026-03-06-search-criteria-dashboard-and-ingestion.md` | Marketing, founder narrative | Channel-ready launch narrative draft for the criteria/dashboard/ingestion release | Messaging refresh for this release |
| `docs/announcements/2026-03-08-source-quality-guardrails-and-contract-governance.md` | Marketing, founder narrative | Channel-ready narrative for source quality guardrails and contract governance release | Messaging refresh for this release |
| `docs/assets/dashboard-preview.svg` | Users, evaluators | Dashboard visual preview asset | Dashboard visual refresh |
