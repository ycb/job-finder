# Documentation Registry

As of 2026-03-11.

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
| `PRIVACY.md` | Users, contributors | Product privacy posture, data handling, and telemetry boundaries | Privacy policy or telemetry scope changes |
| `TERMS.md` | Users, contributors | Usage terms and legal operating constraints | Terms/licensing/commercial policy changes |
| `docs/documentation-protocol.md` | Contributors | Repeatable documentation governance protocol | Process changes to doc governance |
| `docs/docs-registry.md` | Contributors | Canonical inventory of docs and update triggers | Added/removed/repurposed docs |
| `docs/backlog.md` | Contributors | Prioritized work backlog and status | Backlog reprioritization |
| `docs/how-to.md` | Contributors/users | Operational/how-to playbook | Workflow execution changes |
| `docs/cli-design.md` | Contributors | CLI interaction and UX design principles for command/output behavior | CLI UX direction updates |
| `docs/monetization.md` | Contributors, stakeholders | Monetization model, pricing strategy, and donation/cap policy experiments | Pricing/policy/plan changes |
| `docs/learnings.md` | Contributors | Captured lessons and retrospectives | Postmortems and notable insights |
| `posthog-setup-report.md` | Contributors/operators | Verification report for PostHog SDK/instrumentation baseline in repo | Telemetry setup changes or re-audit events |
| `docs/analytics/event-schema.md` | Contributors/operators | Canonical analytics event schema and PostHog event mapping across channels | Event taxonomy, channel, identity, or telemetry transport changes |
| `docs/analysis/backlog-review.md` | Contributors | Analysis of backlog state and gaps | Backlog review refresh |
| `docs/analysis/product-analysis.md` | Contributors | Product-level analysis and recommendations | Product analysis refresh |
| `docs/analysis/2026-03-06-source-field-coverage-analysis.md` | Contributors | Baseline field-coverage analysis across sources | Coverage measurement refresh |
| `docs/analysis/source-contract-governance.md` | Contributors/operators | Governance model for source contracts and drift handling | Contract model/drift workflow changes |
| `docs/brand/BRAND_GUIDELINES.md` | Contributors/marketing | Brand voice and style rules | Brand direction updates |
| `docs/plans/2026-03-06-search-construction-design.md` | Contributors | Search construction design rationale | Superseding search design changes |
| `docs/plans/2026-03-06-caching-policy-execplan.md` | Contributors | Caching policy implementation plan | Caching strategy changes |
| `docs/plans/2026-03-06-linkedin-capture-depth-and-source-verification-execplan.md` | Contributors | LinkedIn capture depth/source verification plan | Capture-depth strategy changes |
| `docs/plans/2026-03-06-data-quality-epic-execplan.md` | Contributors | Data-quality epic execution plan | Data-quality strategy changes |
| `docs/plans/2026-03-07-adapter-drift-detection-and-ux-signaling-execplan.md` | Contributors/operators | Adapter drift detection and UX signaling execution plan | Drift detection/UX signaling strategy changes |
| `docs/plans/2026-03-07-adapter-reliability-guardrails-execplan.md` | Contributors/operators | Guardrails/canaries/source-health execution plan | Adapter reliability strategy changes |
| `docs/plans/2026-03-08-phase-1-multi-agent-orchestration-execplan.md` | Contributors/operators | Phase 1 multi-agent orchestration execution plan | Multi-agent execution process updates |
| `docs/plans/2026-03-09-lane-b-w2-04-net-new-refresh-deltas-execplan.md` | Contributors/operators | Lane B execution plan for run-delta persistence and dashboard surfacing | Run-delta persistence/surfacing changes |
| `docs/plans/2026-03-09-phase-1-1-closeout-execution-plan.md` | Contributors/operators | Phase 1.1 closeout implementation sequencing plan for remaining MVP items | Phase 1.1 scope or sequencing changes |
| `docs/plans/2026-03-06-onboarding-analytics-monetization-foundation-execplan.md` | Contributors/operators | Onboarding, consent, analytics, and monetization-foundation execution plan | Onboarding/consent/telemetry contract changes |
| `docs/plans/2026-03-11-dashboard-frontend-foundation-execplan.md` | Contributors/operators | Frontend foundation migration plan (React + Tailwind + shadcn) before full QA closeout | Frontend architecture/stack/sequencing changes |
| `docs/backlog-specs/completed-core-url-construction-rollout.md` | Contributors | Completed URL construction rollout record | Backfilled completion notes |
| `docs/backlog-specs/p0-source-capture-verification-framework.md` | Contributors | P0 source capture verification specification | Verification framework changes |
| `docs/backlog-specs/p0-source-full-jd-gap-closure.md` | Contributors | P0 source full-JD gap closure specification | Source extraction quality roadmap changes |
| `docs/backlog-specs/p0-integrations-read-write-boundary.md` | Contributors/operators | P0 read-vs-write MCP/browser boundary specification | MCP/browser safety boundary changes |
| `docs/backlog-specs/p0-architecture-source-shape-contracts-library.md` | Contributors | P0 source shape contracts library specification | Source contract architecture changes |
| `docs/backlog-specs/p1-core-formatter-diagnostics.md` | Contributors | Formatter diagnostics specification | Diagnostics feature changes |
| `docs/backlog-specs/p1-core-full-jd-pass.md` | Contributors | Full JD verification pass specification | JD verification scope changes |
| `docs/backlog-specs/p1-core-multi-keyword-comma.md` | Contributors | Multi-keyword parsing specification | Keyword parsing changes |
| `docs/backlog-specs/p1-core-multi-search-ranking-blend.md` | Contributors | Multi-search ranking blend specification | Cross-search scoring/ranking changes |
| `docs/backlog-specs/p1-core-net-new-refresh.md` | Contributors | Net-new + refresh incremental run behavior specification | Refresh UX/data lifecycle changes |
| `docs/backlog-specs/p1-core-search-hardfilter-keywords-include-exclude-cache.md` | Contributors | Search controls and hard-filter enhancement specification | Search UX/filter model changes |
| `docs/backlog-specs/p1-core-worktype-field.md` | Contributors | Work type field specification | Work type model changes |
| `docs/backlog-specs/p1-distribution-homebrew.md` | Contributors | Homebrew distribution specification | Packaging/distribution changes |
| `docs/backlog-specs/p1-distribution-npm-publish.md` | Contributors | NPM publish specification | Packaging/distribution changes |
| `docs/backlog-specs/p1-governance-licensing-split.md` | Contributors, operators | Licensing split specification for core vs MCP layer | Licensing/governance policy changes |
| `docs/backlog-specs/p1-integrations-claude-skill.md` | Contributors | Claude skill integration specification | Skill integration changes |
| `docs/backlog-specs/p1-integrations-codex-mcp.md` | Contributors | Codex MCP integration specification | MCP integration changes |
| `docs/backlog-specs/p1-integrations-narrata.md` | Contributors | Narrata integration specification | Narrata integration changes |
| `docs/backlog-specs/p1-onboarding-add-source-skill.md` | Contributors | Add-source skill workflow specification | Source onboarding workflow changes |
| `docs/backlog-specs/p1-onboarding-jf-init.md` | Contributors | `jf init` onboarding specification | Onboarding/init behavior changes |
| `docs/backlog-specs/p1-onboarding-source-auth.md` | Contributors | Source auth onboarding specification | Source auth workflow changes |
| `docs/backlog-specs/p1-architecture-source-type-pattern-library.md` | Contributors | Source-type pattern library specification | Source abstraction architecture changes |
| `docs/backlog-specs/p1-operations-tooling-ownership-metering.md` | Contributors/operators | Internal-vs-external tooling ownership and metering specification | Operational tooling and telemetry model changes |
| `docs/backlog-specs/p1-operations-value-metrics-caps-donations.md` | Contributors/operators | User-value metrics, usage caps, and donation reset verification specification | Monetization/usage-control model changes |
| `docs/backlog-specs/p1-operations-local-storage-retention.md` | Contributors/operators | Local storage management and automatic deletion specification | Storage retention and cleanup workflow changes |
| `docs/backlog-specs/p1-operations-canonical-machine-local-storage.md` | Contributors/operators | Canonical machine-local storage specification | Runtime state-root or migration strategy changes |
| `docs/backlog-specs/p1-source-expansion-greenhouse.md` | Contributors | Greenhouse source expansion specification | Greenhouse roadmap changes |
| `docs/backlog-specs/p1-ux-multi-search-tabs.md` | Contributors | Multi-search tabs UX specification | Multi-context search UX changes |
| `docs/backlog-specs/p2-brand-styles.md` | Contributors | Brand style roadmap specification | Brand roadmap changes |
| `docs/backlog-specs/p2-source-expansion-levelsfyi.md` | Contributors | Levels.fyi source expansion specification | Levels.fyi roadmap changes |
| `docs/backlog-specs/p2-source-expansion-yc.md` | Contributors | YC source expansion specification | YC roadmap changes |
| `docs/backlog-specs/p2-source-quality-employment-type-cleanup.md` | Contributors | Employment-type cleanup and canonicalization specification | Employment-type model, normalization, or filter strategy changes |
| `docs/backlog-specs/p2-source-quality-remoteok-validation.md` | Contributors | RemoteOK quality-validation specification | RemoteOK validation changes |
| `docs/backlog-specs/p2-source-quality-wellfound-bootstrap.md` | Contributors | Wellfound bootstrap quality specification | Wellfound bootstrap changes |
| `docs/backlog-specs/p2-ux-score-histogram-filter.md` | Contributors | Score histogram filter icebox specification | Jobs filter hierarchy or score-range filtering roadmap changes |
| `docs/backlog-specs/p2-ux-remove-searches-page.md` | Contributors | UX page-removal specification | UX roadmap changes |
| `docs/releases/RELEASE_NOTE_TEMPLATE.md` | Contributors | Standard release note structure | Release note format updates |
| `docs/releases/2026-03-06-refresh-policy-and-state.md` | Users, contributors | Dated release note for refresh policy/state foundation | Superseded by follow-up release notes or corrections |
| `docs/releases/2026-03-06-search-criteria-dashboard-and-ingestion.md` | Users, contributors | Dated release note for criteria-first scoring, dashboard flow, and ingestion hygiene updates | Superseded by follow-up release notes or corrections |
| `docs/releases/2026-03-08-source-quality-guardrails-and-contract-governance.md` | Users, contributors | Dated release note for source quality guardrails, canaries, and contract governance | Superseded by follow-up release notes or corrections |
| `docs/releases/2026-03-09-phase-1-1-search-controls-run-deltas-and-trust-gates.md` | Users, contributors | Dated release note for search-controls completion, run deltas, trust gates, retention, and telemetry baseline | Superseded by follow-up release notes or corrections |
| `docs/announcements/ANNOUNCEMENT_TEMPLATE.md` | Contributors/marketing | Standard LinkedIn/Substack post pack structure | Announcement format updates |
| `docs/announcements/2026-03-06-refresh-policy-and-state.md` | Marketing, founder narrative | Channel-ready launch narrative draft for 2026-03-06 release | Messaging refresh for this release |
| `docs/announcements/2026-03-06-search-criteria-dashboard-and-ingestion.md` | Marketing, founder narrative | Channel-ready launch narrative draft for the criteria/dashboard/ingestion release | Messaging refresh for this release |
| `docs/announcements/2026-03-08-source-quality-guardrails-and-contract-governance.md` | Marketing, founder narrative | Channel-ready narrative for source quality guardrails and contract governance release | Messaging refresh for this release |
| `docs/announcements/2026-03-09-phase-1-1-search-controls-run-deltas-and-trust-gates.md` | Marketing, founder narrative | Channel-ready narrative for Phase 1.1 search controls, run deltas, and trust-gate release | Messaging refresh for this release |
| `docs/roadmap/decision-log.md` | Stakeholders, contributors | Decision log with autonomous vs approval-required buckets | Any roadmap decision or approval event |
| `docs/roadmap/kickoff/2026-03-08-mvp-phase-1-kickoff.md` | Stakeholders, contributors | Dated kickoff charter for MVP Phase 1 scope, sequencing, and accountability | Phase kickoffs or kickoff revision approvals |
| `docs/roadmap/kickoff/2026-03-09-mvp-phase-1-1-closeout.md` | Stakeholders, contributors | Dated closeout scope charter for remaining Phase 1 MVP follow-on work | Phase closeout scope changes |
| `docs/roadmap/phase-1-dispatch-board.md` | Stakeholders, contributors | Active dispatch control board for lane/worktree/task gate tracking | Any active queue, lane, or gate-state change |
| `docs/roadmap/frontend-foundation-dispatch-board.md` | Stakeholders, contributors | Dispatch board for frontend foundation migration lanes and merge gates | Any frontend lane/gate/dependency state change |
| `docs/roadmap/phase-1-execution-tracker.md` | Stakeholders, contributors | Live Phase 1 status/dependency tracker for MVP execution | Any status/dependency/milestone change in Phase 1 |
| `docs/roadmap/progress-merge/2026-03-08-1b18d56.md` | Stakeholders, contributors | Merge-to-main execution report for safety-boundary milestone | Each merge to main for roadmap-tracked work |
| `docs/roadmap/progress-merge/2026-03-08-444d199.md` | Stakeholders, contributors | Merge-to-main execution report for source-contracts schema milestone | Each merge to main for roadmap-tracked work |
| `docs/roadmap/progress-merge/2026-03-08-2dd4c6f.md` | Stakeholders, contributors | Merge-to-main execution report for source-contract diagnostics milestone | Each merge to main for roadmap-tracked work |
| `docs/roadmap/progress-merge/2026-03-08-d552f35.md` | Stakeholders, contributors | Merge-to-main execution report for formatter diagnostics completion milestone | Each merge to main for roadmap-tracked work |
| `docs/roadmap/progress-merge/2026-03-08-44d227c.md` | Stakeholders, contributors | Merge-to-main execution report for multi-keyword criteria completion milestone | Each merge to main for roadmap-tracked work |
| `docs/roadmap/progress-merge/2026-03-08-c264403.md` | Stakeholders, contributors | Merge-to-main execution report for analytics schema/mapping completion milestone | Each merge to main for roadmap-tracked work |
| `docs/roadmap/progress-merge/2026-03-08-34ad002.md` | Stakeholders, contributors | Merge-to-main execution report for retention-policy completion milestone | Each merge to main for roadmap-tracked work |
| `docs/roadmap/progress-daily/README.md` | Stakeholders, contributors | Daily roadmap update artifact conventions | Daily progress process changes |
| `docs/roadmap/progress-daily/2026-03-08.md` | Stakeholders, contributors | Daily kickoff update for Phase 1 orchestration setup | Daily roadmap update cycle |
| `docs/roadmap/progress-daily/2026-03-09.md` | Stakeholders, contributors | Daily update covering Phase 1.1 closeout scope and verification-gate changes | Daily roadmap update cycle |
| `docs/roadmap/progress-daily/2026-03-10.md` | Stakeholders, contributors | Daily update covering onboarding branch integration rebase, QA, and merge readiness | Daily roadmap update cycle |
| `docs/roadmap/progress-merge/README.md` | Stakeholders, contributors | Merge-to-main roadmap update artifact conventions | Merge update process changes |
| `docs/roadmap/progress-merge/2026-03-09-lane-a-w2-03-playwright-smoke.md` | Stakeholders, contributors | Lane A smoke-check evidence for search-controls completion | Merge verification evidence refresh |
| `docs/roadmap/progress-merge/2026-03-09-lane-b-w2-04.md` | Stakeholders, contributors | Lane B merge report for run-delta persistence and surfacing | Merge verification evidence refresh |
| `docs/roadmap/progress-merge/2026-03-10-onboarding-integration-qa.md` | Stakeholders, contributors | Integration QA report for rebased onboarding branch merge onto main | Onboarding integration verification refresh |
| `docs/roadmap/retros/README.md` | Contributors | Virtual-retro artifact conventions | Retro process changes |
| `docs/roadmap/retros/2026-03-08.md` | Stakeholders, contributors | Daily retro for kickoff + multi-agent orchestration setup | Daily retro cadence and process-learning updates |
| `docs/roadmap/retros/2026-03-08-1b18d56.md` | Stakeholders, contributors | Merge-level retro for safety-boundary execution slice | Merge-triggered retrospective cadence |
| `docs/roadmap/retros/2026-03-08-444d199.md` | Stakeholders, contributors | Merge-level retro for source-contracts schema execution slice | Merge-triggered retrospective cadence |
| `docs/roadmap/retros/2026-03-08-2dd4c6f.md` | Stakeholders, contributors | Merge-level retro for source-contract diagnostics execution slice | Merge-triggered retrospective cadence |
| `docs/roadmap/retros/2026-03-08-d552f35.md` | Stakeholders, contributors | Merge-level retro for formatter diagnostics completion slice | Merge-triggered retrospective cadence |
| `docs/roadmap/retros/2026-03-08-44d227c.md` | Stakeholders, contributors | Merge-level retro for multi-keyword criteria completion slice | Merge-triggered retrospective cadence |
| `docs/roadmap/retros/2026-03-08-c264403.md` | Stakeholders, contributors | Merge-level retro for analytics schema/mapping completion slice | Merge-triggered retrospective cadence |
| `docs/roadmap/retros/2026-03-08-34ad002.md` | Stakeholders, contributors | Merge-level retro for retention-policy completion slice | Merge-triggered retrospective cadence |
| `docs/roadmap/task-packets/2026-03-08-phase1-wave1.md` | Contributors/operators | Copy/paste dispatch packets for Phase 1 Wave 1 tasks | Queue/scope/dependency changes for Wave 1 execution |
| `docs/roadmap/task-packets/2026-03-11-dashboard-frontend-foundation.md` | Contributors/operators | Copy/paste dispatch packets for frontend foundation migration lanes (F1/F2) | Queue/scope/dependency changes for frontend migration execution |
| `docs/assets/dashboard-preview.svg` | Users, evaluators | Dashboard visual preview asset | Dashboard visual refresh |
| `docs/roadmap/progress-merge/2026-03-09-lane-b-w2-04-playwright-smoke.png` | Stakeholders, contributors | Playwright screenshot evidence for lane B dashboard run-delta UX | Merge verification asset refresh |
