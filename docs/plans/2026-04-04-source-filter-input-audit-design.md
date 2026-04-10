# Source Filter Input Audit Design

**Goal:** Produce a repeatable, automation-driven audit across the 6 supported sources that maps all source-level filters and their input types, so we can compare each source’s native filter surface to JobFinder’s criteria set.

## Scope & Outputs

- Audit all 6 sources in the source library (LinkedIn, Built In, Indeed, ZipRecruiter, YC, Levels).
- Use the current URL builder + `source-criteria.json` to construct each source’s search URL.
- Use a JS probe to enumerate filter controls and input types.
- Write artifacts:
  - `docs/analysis/2026-04-04-source-filter-input-audit.json`
  - `docs/analysis/2026-04-04-source-filter-input-audit.md`

## Data Collected Per Source

- `sourceId`, `sourceType`, `searchUrl`
- `pageTitle`, `finalUrl`
- `filters[]` with:
  - `inputType` (`text`, `typeahead`, `select`, `checkbox`, `slider`, `radio`, `unknown`)
  - `label` (best-effort visible label or aria label)
  - `placeholder` / `aria-autocomplete` / `role`
  - `selector` (stable CSS selector)
- `status` (`ok`, `blocked`, `error`) with `errorMessage` if applicable

## Data Flow

1. Build each source’s search URL from the shared URL builder.
2. Open each source in a **new Chrome window**.
3. Run a JS probe to collect filter controls and their input types.
4. Normalize results into a per-source filter map.
5. Emit JSON + Markdown artifacts.

## Error Handling & Fidelity

- If a source is blocked by auth walls or bot checks, mark `status=blocked` and capture any visible banner text.
- If the probe fails, mark `status=error` and include the error string.
- Distinguish “blocked/unreachable” vs “not present” for each filter.

## Notes

- All sources should be logged in; the audit may call the auth-check probe before the scan to avoid hiccups.
- The automation is read-only; it should not apply filters.
