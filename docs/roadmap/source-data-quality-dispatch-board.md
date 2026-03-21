# Source Data Quality Dispatch Board

As of 2026-03-20.

## Lane Status

| Lane | Scope | Dependency | Branch/Controller | Session | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `L1` | LinkedIn source-quality repair | soft | `codex/controller-source-data-quality` | `019d0a14-d26b-7240-b5ad-c4c12f751c64` | integrated | Query tightening and cleanup changes integrated; next step is live QA against the user's real auth/session state. |
| `L2` | Indeed degraded-but-honest behavior | soft | `codex/controller-source-data-quality` | `019d0a14-dc38-76f1-a45c-bb3fb9c8dba3` | integrated | Verified current branch behavior is already correct for challenge classification, bogus-total suppression, and latest-attempt vs last-success reporting; remaining risk is live wording variance only. |
| `L3` | ZipRecruiter job-specific deep-link fix | soft | `codex/controller-source-data-quality` | `019d0a27-f116-79b0-b5b5-7daf3449269f` | integrated | Posting-specific `lk=`/`uuid` deep links are preserved through normalization and review-target resolution; controller targeted verification passed (`25/25` including Zip and Built In guard coverage). |
| `L4` | YC Jobs MVP source build | soft | `codex/controller-source-data-quality` | `019d0a27-f834-7962-8c0b-b6340f0aaf24` | in progress (`~20%`) | Primary worker owns the adapter/capture/import path. Controller is assigning support capacity for registration/schema/cache-policy so the lane stops stalling on broad surface area. |
| `L5` | Levels.fyi MVP source build | soft | `codex/controller-source-data-quality` | `019d0d86-efcb-71f2-aa59-c07777aa6732` | in progress (re-scoped) | Primary worker owns the direct HTTP adapter and bounded detail enrichment. Controller is assigning support capacity for registration/tests so the lane has active follow-up instead of idle polling. |
| `L6` | Built In baseline guard + regression rubric | soft | `codex/controller-source-data-quality` | `019d0d86-fbbd-7270-a7b9-d32ac13700f2` | integrated | Built In baseline rubric is landed and passing in controller verification; use this source as the quality reference for direct non-auth MVP sources. |

## Completed Non-MVP Spikes

| Scope | Session | Outcome |
| --- | --- | --- |
| `Google Jobs adapter quality` | `019d0a14-dc38-76f1-a45c-bb3fb9c8dba3` | Returned as non-MVP analysis / optional future adapter work. |
| `Ashby novelty spike` | `019d0a27-f834-7962-8c0b-b6340f0aaf24` | Recommendation: defer from MVP; current brute-force portal scanning yields poor novelty relative to crawl breadth. |
| `Shared search-construction audit` | `019d0d86-fbbd-7270-a7b9-d32ac13700f2` | Returned; confirms upstream query/URL semantics failures are material. |

## Controller Rules

- Controller branch: `codex/controller-source-data-quality`
- Implementer lanes must not revert or overwrite unrelated concurrent changes.
- Review order per lane:
  1. implementer/explorer output
  2. controller synthesis
  3. verification
- This work counts as `parallel` because six lanes have explicit scope and active session evidence.

## Merge Gates

- `P0` source-trust/reporting fixes remain mandatory for launch:
  - run resilience
  - last-attempt vs last-success reporting
  - challenge classification
  - bogus expected-count suppression
- Active MVP source gates:
  - `LinkedIn` must be trustworthy enough for live auth-based capture
  - `Built In SF` must stay healthy as the baseline source
  - `Indeed` must degrade honestly under Cloudflare
  - `ZipRecruiter` must open job-specific deep links
  - `YC Jobs` must be built
  - `Levels.fyi` must be built
- Returned lanes should be reviewed and either integrated or explicitly deferred immediately; controller should not leave completed lane output idle.
- While build lanes remain open, controller must actively recycle freed worker capacity onto them with disjoint ownership and explicit follow-up checkpoints.

## Current Risks

- Current branch still contains uncommitted controller-side backlog/docs updates.
- Existing-user QA remains constrained by checkout-local storage until canonical machine-local storage ships.
