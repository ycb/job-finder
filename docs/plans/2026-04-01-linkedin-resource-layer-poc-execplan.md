# LinkedIn Resource Layer POC

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Prove whether the richer LinkedIn first-page job set exposed in runtime resource URLs can be fetched and parsed into MVP job records. The live diagnostic already showed:

- `outerHTML` document snapshot is partial
- hidden structured payloads yield only `7` jobs
- browser resource activity exposes `25` first-page job ids

This POC should answer the next question directly: can we fetch the live `voyagerJobsDashJobCards` response body from the page context and reconstruct the first page of jobs without relying on visible hydrated cards?

## Progress

- [x] (2026-04-01 23:11Z) Recorded the live-diagnostic result proving the richer first-page job set exists in the resource layer.
- [x] (2026-04-01 23:18Z) Added parser coverage for extracting structured jobs from raw API response bodies instead of only hidden HTML payloads.
- [x] (2026-04-01 23:25Z) Implemented a live resource-layer POC that fetches `voyagerJobsDashJobCards` URLs from the page context.
- [x] (2026-04-01 23:33Z) Ran the POC against the canonical LinkedIn search and confirmed it reconstructs the first-page job set with MVP fields.

## Surprises & Discoveries

- Observation: the resource layer is already richer than the hidden payloads.
  Evidence: the live diagnostic reported `resourceJobCount = 25` vs `structuredCount = 7` on the same first-page search.

- Observation: the `voyagerJobsDashJobCards` response is accessible from the live page context once the request reuses LinkedIn's CSRF token and Rest.li protocol header.
  Evidence: the first raw same-origin XHR returned `403`, but the CSRF-aware rerun returned `200`.

- Observation: the normalized `job-cards` API body contains the MVP metadata directly in regular recipe objects even though it does not use the older `$type = JobPostingCard` shape.
  Evidence: the successful POC found `jobPostingTitle: 25`, `primaryDescription: 25`, and `tertiaryDescription: 25`, and reconstructed 25 first-page jobs including `Product Manager · Crossing Hurdles`, `Senior Product Manager · Hirewell`, and `Product Manager · Passive`.

## Decision Log

- Decision: test direct fetch of LinkedIn resource URLs from the page context before attempting another DOM or row-activation refactor.
  Rationale: if the live `voyagerJobsDashJobCards` response body contains the missing metadata, the correct refactor is resource/state-first rather than visible-card-first.
  Date/Author: 2026-04-01 / Codex

## Outcomes & Retrospective

This plan is complete. One runnable script can:

- discover the live `voyagerJobsDashJobCards` first-page URL from current resource entries
- fetch that URL from the LinkedIn page context
- parse the response into job records with stable ids, titles, companies, and canonical URLs
- report whether coverage is materially better than the current `7`-job hidden-payload slice

The live result was:

- `fetchStatus = 200`
- `extractedCount = 25`

So the next LinkedIn refactor should target resource/state parsing. The blocker was not irregular data and not lack of availability; it was that the existing extractor was reading the wrong surfaces.
