# F2-D Searches Slice Smoke Evidence (2026-03-11)

Lane: `F2-D Searches Slice`  
Branch: `codex/worktrees/frontend-f2-d-searches`

## Command

`node scripts/playwright-searches-flow-smoke.js --artifact-prefix 2026-03-11-f2-d --output-dir docs/roadmap/progress-merge --port 4511`

## Outcome

Pass (`ok: true`).

Verified flow markers:

- main `Searches` tab renders active (`data-state="active"`)
- `Enabled` sub-tab renders active by default
- `Search frequency` control renders only in `Enabled`
- first-visit welcome toast appears on Searches Enabled view
- `Go to Disabled` CTA switches to `Disabled` tab
- `Disabled` tab renders `Enable` row actions
- returning to `Enabled` shows `Run now` action
- reload confirms welcome toast does not reappear (first-visit once)

## Artifacts

- Screenshot: `docs/roadmap/progress-merge/2026-03-11-f2-d-react-searches.png`
- Smoke log: `docs/roadmap/progress-merge/2026-03-11-f2-d-react-searches.log`
