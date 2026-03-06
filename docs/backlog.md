# Backlog

As of 2026-03-06.

## Active

### P0
- Wellfound criteria bootstrap via UI capture
  - Problem: `wellfound_search` is still an explicit URL-format stub and reports criteria as unsupported.
  - Scope:
    - Open `https://wellfound.com/jobs` in Playwright-driven capture.
    - Apply canonical criteria in UI (keywords, location, salary, date posted, experience).
    - Capture filtered results and persist normalized URL/capture metadata.
  - Definition of done:
    - `wellfound_search` no longer drops all criteria in URL bootstrap flow.
    - Automated tests cover criteria application + extraction.

### P1
- Persist formatter diagnostics for CLI/dashboard
  - Problem: unsupported criteria fields are available during URL preview but are not persisted as reusable source diagnostics.
  - Scope:
    - Store `unsupported` + notes per source after normalize/derive.
    - Surface diagnostics in dashboard and CLI source views.
  - Definition of done:
    - Diagnostics survive reloads and are visible without rerunning dry-run preview.

### P1
- Add Greenhouse source via portal abstraction
  - Scope:
    - Introduce `greenhouse_search` source type, collector, CLI add command, and schema support.
    - Generalize Ashby-style portal discovery so both Ashby and Greenhouse can share it.
    - Define portal search breadth from Google subdomain discovery results.
  - Definition of done:
    - Greenhouse sources ingest jobs end-to-end with tests.

### P1
- Page-level full JD keyword verification pass
  - Problem: list/search result snippets can miss or omit required terms, causing false positives in scoring.
  - Dependency:
    - Scrape salary data for Built In matches so full-JD pass has complete compensation context.
  - Scope:
    - Open each candidate job detail page during ingestion/evaluation.
    - Extract full job-description text and re-run keyword/required-term checks on that text.
    - Persist pass/fail signal and explanation for downstream scoring/review.
  - Definition of done:
    - Hard-filter/keyword decisions use full JD text when detail-page fetch succeeds.
    - Tests cover both snippet-only fallback and full-JD recheck paths.

### P2
- Add Y Combinator jobs source
  - Seed URL: `https://www.ycombinator.com/jobs/role/product-manager`
  - Scope:
    - Pick parser strategy (static HTML parse first unless blocked, then browser capture).
    - Add source schema support, collector, and regression tests.
  - Definition of done:
    - YC source appears in configured sources and contributes jobs to shortlist pipeline.

## Completed / Retired

- URL-based search construction abstraction rollout
  - Completed for `linkedin`, `builtin`, `google`, `ashby`, `indeed`, `ziprecruiter`, and `remoteok`.
  - `wellfound` remains a known UI-bootstrap outlier tracked in active P0.
