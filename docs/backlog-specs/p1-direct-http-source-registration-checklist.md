# Direct HTTP Source Registration Checklist

This checklist captures the reusable registration/config/reporting surfaces that any new direct HTTP source must satisfy before it can join the MVP slate.

## Required Surfaces

- Source library entry exists with:
  - stable `id`
  - user-facing `name`
  - source `type`
  - canonical `searchUrl`
  - explicit default `enabled` state
  - cache TTL default appropriate for direct HTTP sources
- `validateSources` accepts the source type and normalizes the source config without special-case errors.
- Cache policy returns the correct default TTL for the source type.
- Reporting and health surfaces show honest status values:
  - last attempted run
  - last successful run
  - last error or challenge state
  - no fabricated counts or fallback zeros for unknown metrics

## Reusable Test Pattern

- Add a registration-focused test that proves:
  - the source appears in the source library
  - the source type is accepted by schema validation
  - the default cache TTL is correct
  - the source can be materialized from the library map without losing metadata

## Non-Goals

- Adapter/parser/detail-enrichment implementation
- Search-construction optimization
- Novelty/redundancy analysis

## Notes

- This checklist is intentionally lightweight.
- The same pattern should be reused for future direct HTTP sources instead of rewriting registration expectations from scratch.
