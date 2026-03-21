# P1 Source Quality: Fix ZipRecruiter Job-Specific URL Resolution

- Priority: P1
- Theme: Source Coverage Expansion

## Context

ZipRecruiter is in the approved MVP source slate because it adds broad employer-direct coverage and strong user-perceived completeness. The current blocker is not basic capture; it is that `View Job` can open a company-wide jobs surface instead of the exact posting the user selected.

Example:

- Current broken behavior:
  - `https://www.ziprecruiter.com/co/Turo/Jobs/-in-San-Francisco,CA?lk=lE73uAE4_huHax-QCPGn7A`
- Expected job-specific deep link:
  - `https://www.ziprecruiter.com/co/Turo/Jobs/-in-San-Francisco,CA?lk=uZgxKlsLSca-m66Nl2T-WQ`

This is a direct apply-flow failure and therefore a blocker for including ZipRecruiter in the launch source slate.

## Why It Matters

If a user clicks `View Job` and lands on a company board instead of the exact posting, the source stops being actionable. That undermines the core promise of Job Finder: collect local data the user can immediately act on.

## MVP Scope

- Preserve the canonical job-specific ZipRecruiter URL for each captured posting.
- Verify that URL normalization does not collapse distinct postings onto a single company-board URL.
- Follow or preserve the job-specific `lk=` target needed to reopen the selected posting.
- Ensure review targets and exported links open the exact posting when the posting is still live.
- Add regression tests for URL parsing/normalization and review-target routing.

## Out of Scope

- Broader ZipRecruiter parser redesign unrelated to deep-link correctness.
- Fancy fallback UX when the exact posting has truly expired.

## Acceptance Criteria

- `View Job` from the Jobs detail pane opens the specific ZipRecruiter posting, not the generic company board.
- Stored ZipRecruiter URLs remain job-specific across capture, normalization, and review-target routing.
- Tests cover at least one realistic company-board URL pair where distinct `lk=` values must remain distinct.
- Source remains in the approved MVP slate once this fix is verified.

## Dependencies

- Existing review-target routing logic in `src/review/server.js`
- ZipRecruiter adapter/capture normalization path

## Definition of Done

- Fix implemented and verified against a real captured ZipRecruiter posting.
- Regression tests added.
- No regression in other source review targets.
