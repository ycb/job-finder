# Documentation Protocol

As of 2026-03-06.

## Objective

Keep documentation synchronized with shipping behavior, release history, and external messaging.

## Scope

This protocol governs:

- product docs (`README.md`, `INSTALL.md`)
- engineering docs (`CLAUDE.md`, `docs/plans/*`, analysis/backlog docs)
- release history (`CHANGELOG.md`, `docs/releases/*`)
- external narrative docs (`docs/announcements/*`)

## Repeatable Workflow

1. Establish change scope from git.
2. Identify behavior/config/UX/ops changes.
3. Map each change to required documentation targets.
4. Update core docs first (`README.md`, `INSTALL.md`) for user-visible changes.
5. Update technical context docs (`CLAUDE.md`, plans, backlog/spec docs) for contributor-facing changes.
6. Append release history (`CHANGELOG.md` and a dated file under `docs/releases/`).
7. Draft outbound narrative under `docs/announcements/` from the same factual change set.
8. Verify examples and commands by running them.

## Documentation Impact Matrix

- CLI command additions/flags/semantics:
  - Update `README.md`, `INSTALL.md`, `CHANGELOG.md`, and a dated release note.
- Scoring/source/ranking behavior changes:
  - Update `README.md`, relevant spec/plan doc, `CHANGELOG.md`, and release note.
- Capture reliability/caching/refresh policy changes:
  - Update `README.md`, `INSTALL.md` troubleshooting, `CHANGELOG.md`, and release note.
- Dashboard UX changes:
  - Update `README.md` review/dashboard sections and release note.
- Internal architecture/process-only changes:
  - Update `CLAUDE.md` and/or `docs/plans/*`; still add release note when operationally relevant.

## Brainstormed Gaps Filled

Prior gaps identified:

- No durable release chronology.
- No explicit “launch narrative” artifact for LinkedIn/Substack.
- No canonical inventory of docs and owner-purpose mapping.

Additions now required:

- `CHANGELOG.md` for concise chronology.
- `docs/releases/` for structured release notes.
- `docs/announcements/` for promotion + professional-credential narratives.
- `docs/docs-registry.md` as canonical docs inventory.

## Definition of Done for a Documentation Pass

- Every user-visible behavior change is documented in `README.md` or `INSTALL.md`.
- Every release-significant change appears in `CHANGELOG.md` and one dated release note.
- Outbound summary draft exists in `docs/announcements/` when work is share-worthy.
- `docs/docs-registry.md` reflects added, renamed, or removed documentation files.
