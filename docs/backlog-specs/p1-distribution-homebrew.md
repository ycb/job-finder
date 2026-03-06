# P1 Distribution: Publish to Homebrew

- Priority: P1
- Theme: Distribution

## Why
Many target users prefer Homebrew for CLI lifecycle management.

## Impact
Native brew install/upgrade flow increases accessibility and credibility on macOS/Linux.

## Detailed Spec
- Dependency: NPM publish flow is stable.
- Build standalone binaries with `pkg` targets:
  - `node20-macos-arm64`
  - `node20-macos-x64`
  - `node20-linux-x64`
- Publish binaries as GitHub release assets per version.
- Create tap/formula (`homebrew-job-finder/Formula/job-finder.rb`) with pinned URL and `sha256`.
- Validate install path:
  - `brew tap <org>/job-finder`
  - `brew install job-finder`
  - `jf init`
- Document maintenance/update workflow (`brew upgrade`).

## Acceptance Criteria
- Users can install and upgrade `jf` via Homebrew.
- Release workflow includes Homebrew update after NPM release.
