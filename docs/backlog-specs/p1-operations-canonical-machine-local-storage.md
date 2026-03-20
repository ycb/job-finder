# P1 Operations: Canonical Machine-Local Storage

- Priority: P1
- Theme: Operations & Tooling

## Context
Job Finder is local-first, but app state is currently stored relative to the repo/worktree that launches the app:

- `data/jobs.db`
- `data/user-settings.json`
- `config/sources.json`
- `config/source-criteria.json` / `config/search-criteria.json`
- `config/profile-source.json`

That means one user can have multiple disconnected "local" states depending on which branch, worktree, or repo checkout is active.

## Why It Matters
Repo-relative app state breaks a core expectation: local state should belong to the user and machine, not to a git checkout.

This creates real problems:

- existing-user QA can show an empty app even when the user has real history elsewhere
- branch/worktree switching fragments searches, jobs, and settings
- retention/cleanup behavior becomes hard to reason about across duplicated state trees
- upgrades and release testing feel unsafe because the visible app state depends on cwd

## User/Business Value
- Users keep one persistent history of imported, applied, rejected, and skipped jobs regardless of branch/repo.
- Existing-user QA becomes straightforward and reliable.
- Distribution via npm/Homebrew becomes more coherent because app state no longer depends on repo layout.
- Product trust improves because "local-first" now means user-local, not checkout-local.
- Repo-clone users are protected from accidental state fragmentation when they pull multiple copies of the project or switch branches locally.

## MVP Scope
- Define one canonical machine-local app-data root, independent of git checkout.
  - macOS/Linux initial default can be `~/.job-finder/`
  - final implementation should be abstracted so OS-specific app-data directories can be adopted cleanly later
- Treat this as the default runtime behavior for real users as well as developers. The canonical state root is not a dev-only QA convenience.
- Move persistent runtime state under that root:
  - jobs DB
  - user settings
  - source/search criteria
  - profile source pointer
  - capture artifacts and refresh state where appropriate
- Keep repo-relative example files and developer fixtures in the repo, but stop treating repo-relative runtime state as canonical user state.
- Add a first-run migration path:
  - detect existing repo-relative state
  - migrate/copy it into the canonical storage root once
  - avoid destructive deletion until migration is confirmed
- Add an explicit override for development/clean-state QA:
  - env var and/or CLI flag to point Job Finder at an alternate state root
  - enables isolated new-user QA without corrupting persistent user state
- Update CLI/dashboard surfaces to reveal the active state root when useful for debugging.
- Update install/QA docs to distinguish:
  - persistent user state
  - temporary/isolated QA state

## Future Work (Out of MVP)
- OS-native app-data roots by platform (`~/Library/Application Support/...`, XDG dirs, etc.).
- Named profiles/workspaces (for example separate work vs personal searches).
- Export/import/backup flows for full local state portability.
- Optional encrypted local state for sensitive metadata.

## Metrics
- `% QA sessions that use existing-user data without manual data-copy steps`
- `% users encountering accidental empty-state after branch/repo switch`
- `% successful state migrations from repo-relative storage`
- `% support/debugging incidents caused by storage-path confusion`
- `median number of duplicate local state roots per machine`

## Definition of Done
- Job Finder uses one canonical machine-local state root by default.
- Existing-user history persists across repo/worktree switches.
- A safe migration path exists for repo-relative state already on disk.
- Developers can still run isolated clean-state QA through an explicit override.
- Install and QA docs clearly explain default persistent state vs isolated test state.
- Tests cover default path resolution, migration, override behavior, and non-destructive fallback.

## Complexity
- Size: `M`
- Rationale: cross-cutting path resolution and migration work touching CLI, dashboard, config loading, and QA workflow.

## Dependencies
- `DEPENDS_ON: Publish job-finder to NPM with a repeatable release flow [soft]`
- `DEPENDS_ON: Add local storage controls with status-aware auto-delete ON by default [completed context]`
