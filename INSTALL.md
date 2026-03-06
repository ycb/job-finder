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
node src/cli.js run
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

### 2. Configure Your Profile

```bash
cp config/profile.example.json config/profile.json
cp config/sources.example.json config/sources.json
cp config/search-criteria.example.json config/search-criteria.json

# Optional profile providers
cp config/my-goals.example.json config/my-goals.json
cp config/profile-source.example.json config/profile-source.json
```

Edit the files and add your real preferences/search URLs. `config/search-criteria.json` drives default URL construction and scoring.

Advanced source filtering is available per source via `hardFilter` in `config/sources.json` (`requiredAll`, `requiredAny`, `excludeAny`, `fields`, `enforceContentOnSnippets`).
Note: `searchCriteria.minSalary` is not applied to `ashby_search` URL construction.

### 3. Add Sources (Optional if `config/sources.json` already has what you need)

```bash
# Add job search sources
jf add-source "Senior PM AI" "https://linkedin.com/jobs/search?keywords=senior+product+manager+ai"
jf add-builtin-source "Built In SF" "https://builtin.com/jobs?location=san-francisco"
jf add-wellfound-source "Startups" "https://wellfound.com/jobs"
jf add-ashby-source "Ashby PM" "https://www.google.com/search?q=site:jobs.ashbyhq.com+product+manager" 1m

# View configured sources
jf sources
```

### 4. Run First Pipeline

```bash
jf run
```

`run` performs capture (when needed), sync, score, shortlist, and prints top rows.

### 5. Review Jobs

```bash
jf review
```

Opens dashboard at `http://localhost:4311`.

---

## Daily Workflow

### Manual Sync

```bash
# Refresh data and scoring
jf run

# Force fresh capture/fetch, ignoring cache TTL
jf run --force-refresh

# Optional refresh profiles
JOB_FINDER_REFRESH_PROFILE=safe jf run
JOB_FINDER_REFRESH_PROFILE=probe jf run
JOB_FINDER_REFRESH_PROFILE=mock jf run

# Open dashboard to review
jf review
```

Profile modes:
- `safe` (default): conservative refresh cadence
- `probe`: shorter intervals with policy guardrails
- `mock`: cache-only mode (no live refresh)

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
JOB_FINDER_ENABLE_NARRATA_CONNECT=1 jf review
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
rm -rf data/jobs.db output/shortlist.md output/playwright

# Remove source code
rm -rf /path/to/job-finder
```

---

## Next Steps

- Read [README.md](README.md) for detailed feature documentation
- See [CLAUDE.md](CLAUDE.md) for architecture and development guide
- Join discussions on [GitHub Issues](https://github.com/ycb/job-finder/issues)
