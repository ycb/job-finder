# Installation Guide

## Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **macOS, Linux, or Windows**

## Option 1: Install from Source (Recommended)

```bash
# Clone repository
git clone https://github.com/ycb/job-finder.git
cd job-finder

# Install dependencies
npm install

# Link globally (makes 'jf' command available)
npm link

# Verify installation
jf --version
```

## Option 2: Run from Source Without Global Link

```bash
# Run commands directly from the repo
node src/cli.js help
node src/cli.js init
node src/cli.js review
```

Use this if you do not want to run `npm link`. In the rest of this guide, replace `jf` with `node src/cli.js`.

---

## First-Time Setup

### 1. Initialize Local Database

```bash
jf init
```

This creates the SQLite database at `data/jobs.db` (relative to your project directory).

### 2. Start the Dashboard

```bash
jf review
```

Open `http://localhost:4311`.

### 3. Run Readiness Check (Recommended)

```bash
jf doctor
```

`jf doctor` reports environment checks and source readiness status. On fresh setup, it will warn if `config/sources.json` has not been created yet.

### 4. Complete Onboarding in Dashboard

In `Searches`, complete:
- install channel selection
- analytics preference
- source selection
- source checks

### 5. Enter Search Input and Run

Use the dashboard `Find Jobs` action.

The system will:
- generate searches automatically
- collect jobs from enabled sources
- de-duplicate results
- score jobs from your search input
- store results locally

No `profile.json` / `my-goals.json` setup is required for normal scoring.
No manual search creation is required in the default dashboard flow.

**First sync takes 2-5 minutes** depending on number of sources.

### 6. Review Jobs

---

## Daily Workflow

### Manual Sync

```bash
# Preferred workflow
jf review

# Then update search input and click Find Jobs
```

Optional CLI pipeline:

```bash
jf run
jf run --force-refresh
```

If you intentionally want to ingest quarantined runs for debugging:

```bash
jf run --allow-quarantined
```

### Automated Sync (Recommended)

**Add to crontab (macOS/Linux):**

```bash
# Run daily at 9am
(crontab -l 2>/dev/null; echo "0 9 * * * cd /path/to/job-finder && jf run") | crontab -
```

**Or use launchd (macOS):**

Create `~/Library/LaunchAgents/com.job-finder.daily.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.job-finder.daily</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/jf</string>
        <string>run</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/job-finder</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.job-finder.daily.plist
```

---

## Source Quality Checks (Operator Workflow)

Run these when source behavior changes or before release notes:

```bash
# Contract drift + rolling coverage checks
jf check-source-contracts --window 3 --min-coverage 0.9 --stale-days 30

# Canary checks against configured source expectations
jf check-source-canaries

# Show effective retention policy and path
jf retention-policy
```

Quality diagnostics and evidence paths:

- `data/quality/quarantine/<source-id>/*.json` (blocked/quarantined ingest runs)
- `data/quality/source-health-history.json` (rolling source health metrics)
- `data/quality/source-coverage-history.json` (contract coverage history)
- `data/quality/contract-drift/latest.json` (latest contract drift diagnostics)
- `data/quality/canary-checks/latest.json` (latest canary report)
- `data/retention/cleanup-audit.jsonl` (status-aware cleanup audit log)

---

## Optional Retention Policy Config

If `config/retention-policy.json` is missing, defaults are used:

- `new`: `30` days
- `viewed`: `45` days
- `skip_for_now`: `21` days
- `rejected`: `14` days
- `applied`: never auto-delete

Create `config/retention-policy.json` to override:

```json
{
  "enabled": true,
  "statusTtlDays": {
    "new": 30,
    "viewed": 45,
    "skip_for_now": 21,
    "rejected": 14,
    "applied": null
  }
}
```

Use `jf retention-policy` to confirm the effective policy and resolved file path.

---

## Troubleshooting

### "command not found: jf"

**Fix:** Run `npm link` from the job-finder directory:
```bash
cd /path/to/job-finder
npm link
```

### "Cannot find module"

**Fix:** Install dependencies:
```bash
npm install
```

### LinkedIn capture fails

**macOS Chrome users:** Enable JavaScript from Apple Events:
1. Open Chrome
2. View → Developer → Allow JavaScript from Apple Events

If needed, start bridge manually:

```bash
jf bridge-server 4315 chrome_applescript
```

Alternative: use the snapshot workflow in [README.md](README.md#live-capture-notes).

### Source type is hidden/blocked in dashboard

Some source categories are feature-flagged in the review UI.

```bash
JOB_FINDER_ENABLE_WELLFOUND=1 jf review
JOB_FINDER_ENABLE_REMOTEOK=1 jf review
```

### Source skipped due capture quality guardrails

Run diagnostics first:

```bash
jf check-source-canaries
jf check-source-contracts --window 3 --min-coverage 0.9
```

If you intentionally want to ingest quarantined runs for debugging:

```bash
jf sync --allow-quarantined
# or
jf run --allow-quarantined
```

### Database locked errors

**Fix:** Stop any running `jf review` servers:
```bash
pkill -f "jf review"
# Or press Ctrl+C in terminal running review
```

### Port 4311 already in use

**Fix:** Kill the process using port 4311:
```bash
lsof -ti:4311 | xargs kill
```

Or change the port:
```bash
jf review 4312
```

---

## Uninstall

```bash
# Remove global link
npm unlink -g job-finder

# Remove local data/output (optional)
rm -rf data/jobs.db output/shortlist.json output/playwright data/quality

# Remove source code
rm -rf /path/to/job-finder
```

---

## Next Steps

- Read [README.md](README.md) for detailed feature documentation
- See [CLAUDE.md](CLAUDE.md) for architecture and development guide
- Review [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md) for data/usage policies
- Join discussions on [GitHub Issues](https://github.com/ycb/job-finder/issues)
