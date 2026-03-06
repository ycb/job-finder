# Installation Guide

## Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **macOS, Linux, or Windows**

## Option 1: Install from Source (Recommended for Now)

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

## Option 2: NPX (No Install)

```bash
# Run directly without installing
npx job-finder init
npx job-finder run
npx job-finder review
```

**Note:** NPX downloads the package on each run. Use `npm link` for daily use.

## Option 3: Global NPM Install (When Published)

```bash
# Install globally
npm install -g job-finder

# Run commands
jf init
jf run
jf review
```

---

## First-Time Setup

### 1. Initialize Your Profile

```bash
jf init
```

This interactive wizard will:
- Create `~/.job-finder/` directory for local data
- Initialize SQLite database
- Prompt for your job search preferences
- Create example config files

### 2. Configure Your Profile

**Option A: Edit config files directly**

Copy and edit example configs:
```bash
cd config
cp profile.example.json profile.json
cp sources.example.json sources.json

# Edit in your preferred editor
code profile.json
code sources.json
```

**Option B: Use CLI commands**

```bash
# Add job search sources
jf add-source "Senior PM AI" "https://linkedin.com/jobs/search?keywords=senior+product+manager+ai"
jf add-builtin-source "Built In SF" "https://builtin.com/jobs?location=san-francisco"
jf add-wellfound-source "Startups" "https://wellfound.com/jobs"

# View configured sources
jf sources
```

### 3. Run First Sync

```bash
jf run
```

This will:
- Collect jobs from all configured sources
- De-duplicate across platforms
- Score each job against your profile
- Store results in local database

**First sync takes 2-5 minutes** depending on number of sources.

### 4. Review Jobs

```bash
jf review
```

Opens dashboard at `http://localhost:4311` where you can:
- See all jobs in one ranked list
- Filter by score, source, status
- Click to view full details
- Mark as applied/rejected/skip
- Track application progress

---

## Daily Workflow

### Manual Sync

```bash
# Run whenever you want fresh jobs
jf run

# Open dashboard to review
jf review
```

### Automated Sync (Recommended)

**Add to crontab (macOS/Linux):**

```bash
# Run daily at 9am
(crontab -l 2>/dev/null; echo "0 9 * * * cd $HOME && jf run") | crontab -
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

**Alternative:** Use manual snapshot workflow (see README)

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
jf review --port 4312
```

---

## Uninstall

```bash
# Remove global link
npm unlink -g job-finder

# Remove data (optional)
rm -rf ~/.job-finder

# Remove source code
rm -rf /path/to/job-finder
```

---

## Next Steps

- Read [README.md](README.md) for detailed feature documentation
- See [CLAUDE.md](CLAUDE.md) for architecture and development guide
- Join discussions on [GitHub Issues](https://github.com/ycb/job-finder/issues)
