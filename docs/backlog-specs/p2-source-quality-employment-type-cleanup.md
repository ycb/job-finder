# P2 Source Quality: Employment-Type Data Cleanup and Canonicalization

- Priority: P2
- Theme: Source Quality

## Why
Employment-type data is currently noisy and semantically mixed across sources, so the UI cannot expose a trustworthy employment-type filter without confusing users.

## Impact
Cleaner and more reliable job metadata, fewer false filters, and a clear path to re-introduce employment-type filtering in the Jobs UI after MVP.

## Findings and Insights
- We currently mix different concepts into `employmentType` in some adapters:
  - Built In composes `workModel` + `seniority` into `employmentType` (for example `remote · senior`) instead of storing those dimensions separately.
- Detail enrichment can join array values and persist source-native labels directly, which increases format drift between sources.
- Several sources frequently return `employmentType: null`, and current source-health contracts allow high unknown rates for optional fields, so coverage stays inconsistent.
- Scoring and UI consume `employmentType` as if it were a single clean concept, but the underlying data is actually a blend of:
  - employment contract type (full-time, contract, internship),
  - work model (remote/hybrid/on-site),
  - seniority level (junior/senior/staff).
- Product implication: Employment-type filters were removed from MVP UI because they produced misleading results despite appearing precise.

## Detailed Spec
- Define canonical field boundaries:
  - `employmentType`: `full_time | part_time | contract | internship | temporary | freelance | unknown`
  - `workModel`: `remote | hybrid | onsite | unknown`
  - `seniorityLevel`: normalized seniority taxonomy already used by ranking/profile logic
- Keep source-native raw values for debugging:
  - `rawEmploymentType`
  - `rawWorkModel`
  - `rawSeniority`
- Add a shared normalization map per source family:
  - map source labels into canonical enums
  - reject/flag composite values that combine multiple concepts into one field
- Update extraction pipeline to prevent concept mixing:
  - stop writing seniority/work-model fragments into `employmentType`
  - prefer source field -> normalized field mapping before fallback regex extraction
- Add data-quality visibility:
  - per-source unknown-rate metrics for `employmentType`, `workModel`, and `seniorityLevel`
  - owner-only alerting when unknown rates or malformed composites cross threshold
- Re-introduce employment-type UI filters only after quality gates pass.

## Scope
- In scope:
  - canonical schema + normalization rules
  - parser/enrichment updates
  - migration/backfill strategy for existing jobs table values
  - validation tests and source-health contract updates
- Out of scope (for this item):
  - self-healing source adapter generation
  - user-facing remediation for parser/schema drift

## Success Metrics
- `employmentType` unknown rate below agreed threshold for primary enabled sources.
- Zero persisted composite values containing mixed concepts (for example `remote · senior`) in canonical `employmentType`.
- Employment-type filter precision is stable enough to re-enable in the Jobs UI.

## Acceptance Criteria
- Canonical schema separates employment contract type, work model, and seniority.
- Source adapters no longer write mixed-concept values into `employmentType`.
- Tests cover normalization mapping, malformed-value rejection, and unknown-rate diagnostics.
- Backfill/migration plan is documented and reversible.
- Product decision log records when employment-type filters can safely return to user-facing UI.
