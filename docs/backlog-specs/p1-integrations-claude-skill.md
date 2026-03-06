# P1 Integrations: Build Claude Code Skill

- Priority: P1
- Theme: Integrations

## Why
Claude-native workflows reduce command friction and enable richer interactive job analysis.

## Impact
Higher usability and deeper AI-assisted analysis within existing Claude sessions.

## Detailed Spec
- Create skill definition and command contract in `SKILL.md`:
  - `/jf-init [linkedin-url|resume-path]`
  - `/jf-run`
  - `/jf-analyze <job-url>`
  - `/jf-track <job-url> [status]`
- Implement skill runtime that invokes local `job-finder` CLI and formats results.
- Support profile extraction and job analysis using Claude context.
- Persist skill-local state/config in stable local path.
- Document installation/setup and command usage examples.

## Acceptance Criteria
- Core commands work end-to-end in Claude Code.
- Setup docs enable reproducible local installation.
- Tests/validation cover setup, run, analyze, and track flows.
