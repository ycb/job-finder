# Levels Pagination Design

**Goal**: Capture all Levels.fyi jobs across pagination (page 1–N) by reusing existing pagination primitives, not inventing a new loop.

## Architecture
- Reuse the shared pagination loop `capturePaginatedGenericBoardJobs`.
- Add minimal Levels pagination DOM helpers:
  - `buildLevelsFyiPaginationInfoScript` to detect whether a Next control exists.
  - `buildLevelsFyiPaginationClickNextScript` to advance.
  - `buildLevelsFyiPaginationWaitScript` to detect page transition via first job id change.
- Keep dedupe/stop logic inside the shared loop.

## Data Flow
1. Apply Levels filters and readiness checks (existing).
2. Capture page 1 via existing Levels DOM capture script.
3. If pagination exists, use the shared loop to:
   - click Next
   - wait for job id change
   - capture next page
   - dedupe jobs by externalId
   - stop on no-new-rows or no Next

## Testing
- Unit tests for the pagination DOM helpers (info + click + wait).
- Small unit test for a pure helper that signals if pagination should proceed.

