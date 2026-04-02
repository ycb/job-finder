# MVP Source Parity Matrix (2026-04-02)

## Canonical QA criteria

- title: `Product manager`
- hard include: `ai`
- location: `San Francisco`
- min salary: `$200,000`
- date posted: `past 3 days`
- hard excludes: `defense, gaming, fintech, retail, payment, search, tax`

## Current contract snapshot

Generated source URLs from the current shared builder and source-library defaults:

- `LinkedIn`
  - `https://www.linkedin.com/jobs/search/?location=San+Francisco%2C+CA&distance=25&keywords=Product+manager+ai&f_TPR=r259200&f_SB2=9`
- `Built In`
  - `https://www.builtinsf.com/jobs/product-management/product-manager?search=Product+manager+ai&city=San+Francisco&daysSinceUpdated=3`
- `Indeed`
  - `https://www.indeed.com/jobs?q=Product+manager+ai&l=San+Francisco%2C+CA&radius=25&salaryType=%24200%2C000&fromage=3`
- `ZipRecruiter`
  - `https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco%2C+CA&page=1`
- `Levels.fyi`
  - `https://www.levels.fyi/jobs/title/product-manager/location/san-francisco?searchText=Product+manager+ai+ai&minBaseCompensation=200000&postedAfterTimeType=days&postedAfterValue=3`
- `YC Jobs`
  - `https://www.workatastartup.com/jobs`

## Fresh live evidence

Single coherent QA run:

- command: `node src/cli.js run --force-refresh`
- completed: `2026-04-02 10:42 America/Los_Angeles`

Fresh `source_run_deltas` rows from that run:

| Source | Found | Filtered | Dupes | Imported | Served from |
| --- | ---: | ---: | ---: | ---: | --- |
| LinkedIn | 75 | 0 | 0 | 75 | live |
| Built In | 2 | 0 | 0 | 2 | live |
| Indeed | 127 | 0 | 75 | 52 | live |
| ZipRecruiter | 57 | 0 | 0 | 57 | live |
| YC Jobs | 30 | 0 | 0 | 30 | live |
| Levels.fyi | 26 | 0 | 0 | 26 | live |

Representative fresh capture artifacts:

- `LinkedIn`
  - `expectedCount=75`
  - `jobs=75`
  - top titles include `Product Manager`, `Director of Product - AgeTech B2B2C SaaS`, `Product Marketing Manager`
- `Built In`
  - `jobs=2`
  - top titles include `Senior Product Manager, Email Content AI`, `Senior Product Manager – Agentic AI Systems`
- `Indeed`
  - `jobs=127`
  - top titles include `Head of Product`, `Senior Product Manager, Agentic AI- IFS Loops`, `Group Product Manager, Generative AI, Google Cloud`
- `ZipRecruiter`
  - `jobs=57`
  - top titles include `Staff AI Product Engineer`, `Principal Product Manager, GPUs and AI Accelerators`, `Product Manager - Conversational AI`

Representative persisted rows for direct sources:

- `Levels.fyi`
  - `Senior Software Engineer (Backend/Infrastructure) - HENNGE Secure Transfer`
  - `IT infrastructure engineer (RMA & Diag)`
  - `Principal Solutions Architect - DACH`
- `YC Jobs`
  - `Founding Engineer`
  - `Founding Full Stack AI Engineer`
  - `Full Stack Software Engineer`

## Pass / fail read

### LinkedIn

- Status: **Pass on extraction, partial on query contract**
- What works:
  - extraction is materially restored
  - fresh run captured `75 / 75`
  - no evidence of the old `similar-jobs` or pagination drift regressions
- Remaining gap:
  - URL still inherits `distance=25` from the source base while the current JobFinder UI does not expose distance
  - this is acceptable operationally, but not ideal parity semantics

### Built In

- Status: **Partial**
- What works:
  - generated query is coherent for title + location + recency
  - live run returned two plausible PM/AI roles
- Remaining gap:
  - `minSalary` is unsupported in the current source contract
  - parity is acceptable for MVP only if we explicitly accept that limitation

### Indeed

- Status: **Partial**
- What works:
  - salary/career page pollution is gone
  - live run returned `127` plausible jobs
  - date posted and salary are mapped into the URL
- Remaining gap:
  - query construction is still compressed into `Product manager ai`
  - `radius=25` is inherited even though the UI does not expose it
  - manual/native parity is plausible but not yet explicitly signed off

### ZipRecruiter

- Status: **Partial**
- What works:
  - live run returned `57` plausible jobs
  - the old broken `0-4` result behavior is no longer current
  - broad manual-equivalent URL works well
- Remaining gap:
  - current builder intentionally leaves `datePosted` and `minSalary` as post-capture filters rather than URL/native filters
  - that means query construction is operationally useful but not full contract parity with the JobFinder form
  - `location` still inherits implicit radius behavior from the site rather than an explicit product control

### Levels.fyi

- Status: **Fail**
- What works:
  - source runs live
  - direct fetch/extraction is functional
- Broken against the product promise:
  - query construction is not narrowing to PM/AI meaningfully
  - persisted rows are dominated by obviously off-target global engineering/infrastructure roles
  - the built URL currently duplicates `ai` in `searchText=Product+manager+ai+ai`
- Conclusion:
  - extraction works
  - query construction and/or source-side narrowing are not honoring the search intent

### YC Jobs

- Status: **Fail**
- What works:
  - source runs live
  - extractor returns stable rows
- Broken against the product promise:
  - current source type ignores dynamic criteria entirely and uses the fixed jobs route
  - persisted rows are dominated by `Founding Engineer` / engineering roles rather than PM+AI roles
  - current builder explicitly marks `title`, `hardIncludeTerms`, `location`, `datePosted`, and `minSalary` unsupported
- Conclusion:
  - extraction works
  - query construction is not aligned with the JobFinder contract

## Recommendation

The highest-value next work is no longer another LinkedIn rescue. It is source-contract parity for the sources that still ignore or dilute the user's actual search:

1. `YC Jobs`
   - either implement dynamic criteria mapping or remove/de-scope it from the active MVP slate until it can honor the search contract
2. `Levels.fyi`
   - fix the query/narrowing path so it returns PM/AI jobs instead of broad global engineering inventory
3. `ZipRecruiter`
   - close the remaining query-construction parity gap around date-posted and salary behavior
4. `Indeed`
   - finish manual/native parity signoff and decide whether inherited radius remains acceptable MVP behavior
5. `Built In`
   - explicitly accept or reject the current unsupported `minSalary` limitation

## Bottom line

The product is closer now:

- LinkedIn: materially restored
- Indeed: no longer catastrophically broken
- ZipRecruiter: no longer in the broken-regression bucket

But the full product promise is still not met because:

- `Levels.fyi` is extracting the wrong class of jobs
- `YC Jobs` still ignores the current search contract
- `ZipRecruiter` and `Indeed` still need explicit query-parity signoff rather than implied confidence
