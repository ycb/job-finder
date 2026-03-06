# Search Construction Abstraction Design

> Scope: Planning/design only. No runtime behavior changes in this document.

## Goal
Create a source-aware search construction layer that takes canonical inputs:
- `keywords`
- `minSalary` (optional)
- `location` and/or `distanceMiles` (optional)
- `datePosted` (optional)
- `experienceLevel` (optional)

and emits board-specific search URLs/parameters using only stable fields.

## Core Recommendation (Challenge to Current Approach)
Do not build directly from arbitrary full URLs. Existing URLs include many transient tracking params (`sxsrf`, `ved`, `lk`, `vjk`, etc.) that are unstable and noisy.

Instead, use:
1. Canonical criteria object (board-agnostic)
2. Per-source formatter that only writes stable board-specific fields
3. Optional post-fetch hard filtering for fields that are not reliably URL-driven on that source

This keeps behavior deterministic and resilient when board UIs change.

## Canonical Criteria Model (Proposed)

```js
{
  keywords: string,                 // required
  minSalary?: number | null,
  location?: string | null,
  distanceMiles?: number | null,
  datePosted?: "any" | "1d" | "3d" | "1w" | "2w" | "1m" | null,
  experienceLevel?:
    | "intern"
    | "entry"
    | "associate"
    | "mid"
    | "senior"
    | "director"
    | "executive"
    | null
}
```

## Source Mapping + Formatting Guide

### `linkedin_capture_file`
- Base: `https://www.linkedin.com/jobs/search-results/`
- Stable params observed: `keywords`, `geoId`, `distance`, `location`, `sortBy`, `start`, `f_*`
- Mapping:
  - `keywords` -> `keywords`
  - `location`/`distanceMiles` -> `geoId` + `distance` (or `location` + `distance` when `geoId` unavailable)
  - `datePosted` -> likely `f_TPR` family (not present in current saved examples; treat as provisional)
  - `experienceLevel` -> likely `f_E` family (not present in current saved examples; treat as provisional)
  - `minSalary` -> no stable mapping from current examples
- Notes from live page: Date Posted and Experience Level filters exist in UI.

### `builtin_search`
- Base host/path in current config: `https://www.builtinsf.com/jobs/...`
- Stable params observed: `search`, `daysSinceUpdated`, `city`, `state`, `country`, `allLocations`
- Mapping:
  - `keywords` -> `search`
  - `location` -> `city`/`state`/`country`
  - `datePosted` -> `daysSinceUpdated` (days integer)
  - `experienceLevel` -> currently encoded in path segments in existing URLs (for example `.../senior/expert-leader`)
  - `distanceMiles`, `minSalary` -> no stable mapping in existing examples

### `wellfound_search`
- Base in current config: `https://wellfound.com/jobs`
- Stable query params observed: none
- Mapping:
  - URL-only construction is limited from existing examples
  - Live UI shows filters for salary, experience, location, employment type, and search terms
- Recommendation:
  - Treat Wellfound as browser-state-driven (set filters via browser automation), not URL-param-driven for v1

### `ashby_search` (Google discovery mode)
- Base: Google query searching `site:ashbyhq.com ...`
- Stable params observed: `q`, `tbs`
- Mapping:
  - `keywords` -> added in `q` alongside `site:ashbyhq.com`
  - `location` -> included as quoted phrase in `q`
  - `minSalary` -> included in `q` as salary term/range text
  - `datePosted` -> `tbs=qdr:<d|w|m>`
  - `experienceLevel` -> include term in `q` (heuristic)
- Strip noisy Google params (`sxsrf`, `ved`, `uact`, etc.).

### `google_search` (Google Jobs vertical style)
- Base: `https://www.google.com/search`
- Stable params observed: `q`, `tbs`, `udm`
- Mapping:
  - `keywords` -> `q`
  - `location` -> appended to `q`
  - `minSalary` -> appended to `q` as range term (for example `$200000..$500000`)
  - `datePosted` -> `tbs=qdr:<d|w|m>`
  - `experienceLevel` -> appended to `q` as term (heuristic)
- Keep `udm=8` when targeting jobs vertical behavior.

### `indeed_search`
- Base: `https://www.indeed.com/jobs`
- Stable params observed in current searches: `q`, `locString`, `latLong`, `radius`, `salaryType`
- Likely tracking/noise params: `from`, `vjk`
- Mapping:
  - `keywords` -> `q`
  - `location` -> `locString` (optionally `latLong` if known)
  - `distanceMiles` -> `radius`
  - `minSalary` -> `salaryType` formatted like `"$195,000"`
  - `datePosted` -> supported in UI (`Date posted` filter), URL key not yet confirmed from existing saved URLs
  - `experienceLevel` -> supported in UI (`Experience level` filter), URL key not yet confirmed from existing saved URLs
- Live UI confirmed filters include: `Pay`, `Within 25 miles`, `Job Type`, `Experience level`, `Date posted`.

### `ziprecruiter_search`
- Base: `https://www.ziprecruiter.com/jobs-search`
- Stable params observed: `search`, `location`, `radius`, `days`, `refine_by_salary`, `refine_by_salary_ceil`, `refine_by_experience_level`, `refine_by_employment`, `refine_by_location_type`, `refine_by_apply_type`
- Likely noise params: `lk`, `page`
- Mapping:
  - `keywords` -> `search`
  - `location` -> `location`
  - `distanceMiles` -> `radius`
  - `datePosted` -> `days`
  - `minSalary` -> `refine_by_salary` (and optional ceiling)
  - `experienceLevel` -> `refine_by_experience_level` (comma-separated list; e.g. `mid,senior`)
- Live UI confirms these filters exist in the modal.

### `remoteok_search`
- Base style: `https://remoteok.com/remote-<tags>-jobs`
- Stable query params observed: none
- Mapping:
  - `keywords` -> slug tags in path
  - `location`, `distanceMiles` -> unsupported (remote-first board)
  - `datePosted` -> no explicit URL filter in current examples
  - `minSalary`, `experienceLevel` -> no stable mapping in current examples
- Live UI offers search text/location inputs and sort, but current source style is path-tag driven.

## Formatter Output Contract (Proposed)
Each source formatter should return:

```js
{
  url: string,
  unsupported: string[],   // canonical fields this source cannot express reliably
  notes: string[]          // optional diagnostics
}
```

`unsupported` should feed post-fetch hard filters where feasible.

## Implementation Entry Points (When Approved)
- Add per-source formatter map (new module, e.g. `src/sources/search-formatters.js`)
- Integrate in config normalization path (`src/config/load-config.js`) without breaking existing manual URLs
- Keep existing `searchUrl` as explicit override for backward compatibility
- Add tests for formatter output per source and noisy-param stripping

## Evidence Used
- Existing source URLs in `config/sources.json`
- Live UI inspection via Playwright MCP:
  - LinkedIn, Built In, Wellfound, ZipRecruiter, Indeed, RemoteOK, Google/Ashby
