# MVP Source Regression Baseline (2026-03-31)

## Purpose

This note captures the first-pass live baseline for the six MVP sources after the QA-path honesty fixes. The point is to separate three different failure classes that have been conflated in recent QA:

1. bad source-native query construction
2. bad browser extraction or direct-fetch capture
3. bad post-capture accounting/evaluation in the Sources table

## Active criteria

- title: `Product manager`
- hard include: `ai`
- location: `San Francisco`
- min salary: `$200,000`
- date posted: `past 3 days`
- hard excludes: `defense, gaming, fintech, retail, payment, search, tax`
- score keywords: `growth, clean energy, climate tech, electrification, 0-1`

## Current live QA batch

Latest verified live-first batch in QA:

- `run_id = 61de70cf-e340-490d-9520-025c7ceeba8d`

Latest semantic run rows:

- `linkedin-live-capture`: `raw_found=11 hard_filtered=9 duplicate_collapsed=0 imported_kept=2 served_from=live`
- `builtin-sf-ai-pm`: `raw_found=0 hard_filtered=0 duplicate_collapsed=0 imported_kept=0 served_from=live`
- `indeed-ai-pm`: `raw_found=7 hard_filtered=4 duplicate_collapsed=0 imported_kept=3 served_from=live`
- `zip-ai-pm`: `raw_found=3 hard_filtered=3 duplicate_collapsed=0 imported_kept=0 served_from=live`
- `levelsfyi-ai-pm`: `raw_found=26 hard_filtered=25 duplicate_collapsed=0 imported_kept=1 served_from=live`
- `yc-product-jobs`: `raw_found=30 hard_filtered=16 duplicate_collapsed=0 imported_kept=14 served_from=live`

These rows are from `source_run_deltas` and reflect the current semantic accounting path, not stale cache or quarantine.

## Source-by-source baseline

### LinkedIn

Generated search URL:

- `https://www.linkedin.com/jobs/search/?keywords=Product+manager+ai&location=San+Francisco&f_TPR=r259200&f_SB2=9`

Raw capture artifact:

- file: `/Users/admin/job-finder/data/captures/linkedin-live-capture.json`
- `expectedCount=57`
- `jobs=34`

Top captured rows include:

- `Product Manager` — Meta — `San Francisco, CA`
- `Product Manager` — Peregrine — `San Francisco, CA`
- `Senior Product Manager - AI/ML & Developer Tools` — IR — `United States (Remote)`
- `Founding Product Manager [32912]` — Stealth Startup — `San Francisco Bay Area (On-site)`
- `Product Manager, AI Platform` — RemoteHunter — `United States (Remote)`

Problem:

- raw capture file says `34` visible job rows with an expected result count of `57`
- latest semantic source row says `11 found / 9 filtered / 2 imported`
- this is not just weak query quality; it is a capture-to-evaluation/accounting mismatch

Current hypothesis:

- LinkedIn query construction is still lossy, but the larger defect is downstream of capture: either normalization, hard-filter evaluation, or source-row semantic accounting is collapsing too many rows after a capture that already looks plausible.

Priority:

- P0 regression investigation

### Built In SF

Generated source is not browser-captured; it runs through direct fetch.

Latest semantic row:

- `0 / 0 / 0 / 0`

Interpretation:

- current run returned nothing useful for this criteria or reused a no-result direct-fetch state
- this source does not currently appear to be the major regression vector, but it needs confirmation in the per-source baseline pass

Priority:

- P2 validation

### Indeed

Generated search URL:

- `https://www.indeed.com/jobs?q=Product+manager+ai&l=San+Francisco&salaryType=%24200%2C000&fromage=3`

Latest semantic row:

- `7 found / 4 filtered / 0 dupes / 3 imported`

Important note:

- earlier salary/career-page regression was real and was fixed
- current live run is modest but not obviously nonsensical in the same way as Zip or LinkedIn

Open issue:

- Indeed still compresses the search into `Product manager ai`, so source-native parity remains imperfect even though the catastrophic salary-page regression has been addressed

Priority:

- P2 after Zip and LinkedIn

### ZipRecruiter

Generated search URL:

- `https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco&days=3&refine_by_salary=200000&page=1`

Raw capture artifact:

- file: `/Users/admin/job-finder/data/captures/zip-ai-pm.json`
- `expectedCount=undefined`
- `jobs=4`

Captured titles:

- `Associate Director Product-AI Platform`
- `Product Manager - Buyer Solutions`
- `Product Manager, Multi-Cloud Growth - Google`
- `Product Manager`

Latest semantic row:

- `3 found / 3 filtered / 0 imported`

Manual baseline from user:

- native Zip search returned `14` results for the same intent
- a later observed browser window on our generated state showed `0` results on a different page state

Problem:

- generated search state is not equivalent to the manual native search
- the extraction wrapper itself is materially unchanged from baseline `934b808`, so the likely issues are:
  - lossy query construction
  - omitted native Zip filters / state
  - bad page-state handling or pagination assumptions
  - later evaluation over-rejecting an already weak capture

Additional direct regression proof:

- live direct capture against the broad manual-equivalent URL `https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco%2C+CA&page=1` captured `57` jobs in one run
- the top captured roles from that broad URL included:
  - `Senior Growth Marketing Manager, AI Marketplace`
  - `Principal Product Manager, GPUs and AI Accelerators`
  - `Product Manager - Conversational AI`
  - `Senior Product Manager, AI`
  - `Product Manager - AI`

Conclusion:

- the current primary Zip regression is URL-side overconstraint
- for MVP parity, Zip should use broad query text plus location in URL and rely on post-capture evaluation for salary/date/distance/experience rather than trying to force those constraints into the native URL

Priority:

- P0 regression fix

### Levels.fyi

Generated source is direct HTTP.

Latest semantic row:

- `26 found / 25 filtered / 0 dupes / 1 imported`

Interpretation:

- source runs live, but source-side narrowing is weak and nearly everything is being rejected by the shared hard filter
- this is not hidden anymore; QA-path honesty now exposes it directly

Priority:

- P1 source-quality tightening, but not the main regression blocker versus Zip/LinkedIn

### YC Jobs

Generated source is currently fixed-route based.

Latest semantic row:

- `30 found / 16 filtered / 0 dupes / 14 imported`

Interpretation:

- broad source, but at least returning a meaningful number of surviving jobs
- no longer inflated by fake duplicate collisions in the current semantic run row
- still needs source-map work, but not currently the primary regression concern

Priority:

- P1/P2 after Zip and LinkedIn

## Regression conclusions

1. The current Zip failure is real and user-visible.
   - It cannot be explained by the recent QA-path honesty work.
   - It is also not explained by one obvious recent change in the Zip browser-capture wrapper.
   - The likely regression surface is the interaction between a lossy generated query and Zip-native page state.

2. LinkedIn has a deeper pipeline inconsistency than a simple low count.
   - The raw capture artifact looks plausibly rich.
   - The semantic source row is much smaller.
   - That means the regression is downstream of capture as well as potentially in query shaping.

3. The product promise is still broken even though the QA environment is now honest.
   - Honest QA exposed the problem; it did not solve it.

## Immediate fix order

1. ZipRecruiter root-cause regression trace and fix
2. LinkedIn capture-to-evaluation/accounting collapse trace and fix
3. Per-source baseline validation for Built In and Indeed
4. Source-side narrowing improvements for Levels.fyi and YC Jobs
