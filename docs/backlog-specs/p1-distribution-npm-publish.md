# P1 Distribution: Publish to NPM

- Priority: P1
- Theme: Distribution

## Why
Repo-clone installs are higher friction than package-manager installs.

## Impact
Simpler install/upgrade flow increases adoption and distribution velocity.

## Detailed Spec
- Finalize package metadata and versioning policy.
- Verify packaged artifact contents and CLI bin wiring (`jf`).
- Define release checklist:
  - version bump
  - changelog/release notes
  - publish command and verification
- Validate post-publish install paths (`npm i -g`, `npx`).

## Acceptance Criteria
- Package is published and installable as `jf`.
- Release checklist is documented and repeatable.
