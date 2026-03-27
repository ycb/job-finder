# P1 Source Map Acceptance Checklist

## Summary

This checklist defines the minimum acceptance bar for adding or materially changing a source. A source is not considered integrated when only its adapter or parser exists. It must satisfy the shared product and runtime contracts that make source behavior understandable, testable, and maintainable.

This checklist is internal-only. It is designed to support future `add a source` work and prevent one-off source implementations from drifting away from the product model.

## Required checks

### 1. Source type and product behavior

- Source type is explicitly classified:
  - direct HTTP / no auth
  - browser/auth
  - company portal
  - other approved type
- Product behavior matches the chosen type:
  - auth-required sources reuse the shared auth modal flow
  - no-auth sources reuse the standard enable/run path
- The source does not invent a bespoke status vocabulary or source-management flow.

### 2. Shared builder and runtime truth

- `config/source-contracts.json` includes the source type.
- The contract covers the full current product criteria surface:
  - `title`
  - `keywords`
  - `keywordMode`
  - `hardIncludeTerms`
  - `includeTerms`
  - `excludeTerms`
  - `location`
  - `distanceMiles`
  - `datePosted`
  - `experienceLevel`
  - `minSalary`
- `src/sources/search-url-builder.js` has an explicit branch for the source type or an approved shared path.
- Criteria-accountability output agrees with actual runtime behavior.
- If a criterion is used only by folding into generic text search, it is documented as supported-but-lossy rather than unsupported.
- If a criterion is enforced only after capture, it is declared as `post_capture`.

### 3. Collection and extraction

- The source is wired into generic collection dispatch.
- Generic review/sync paths can actually collect the source.
- Extraction defines:
  - canonical review target rule
  - required fields
  - optional fields
  - full-detail coverage mode
- The canonical review target is preserved through normalization and review rendering.

### 4. Reporting and source-row trust

- Source rows use the existing public status vocabulary only.
- Source rows can report:
  - `Found`
  - `Filtered`
  - `Dupes`
  - `Imported`
  - `Avg Score`
  - `Last run`
- Unknown historical counts are rendered as unavailable, not zero.
- Latest-attempt vs last-success semantics are preserved where applicable.

### 5. Tests

Minimum automated coverage:

- source registration/config/schema test
- shared builder/accountability test
- adapter/parser test
- canonical review-target test
- source-contract load test
- source-row/API contract test if the source is in MVP UI scope

### 6. Audit output

Before acceptance, every source change must leave behind:

- source type classification
- canonical review-target rule
- supported vs unsupported criteria map
- known lossy mappings
- degradation semantics
- novelty expectation against the current internal baseline

## Acceptance rule

A source is only ready when the contract, builder, accountability output, collection path, and review target all agree. If any of those layers disagree, the source is still in implementation and must not be presented as complete.
