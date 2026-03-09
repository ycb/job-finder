# CLI Design Principles

*Last updated: March 2026*

Design goals: feel like a capable agent working on your behalf, not a script running in the background. Every interaction should be scannable, trustworthy, and fast to act on.

---

## Core Principles

**1. Humans first, machines second**
Output is for reading by default. When piped or redirected (`stdout !== TTY`), strip color, animation, and decoration automatically. Never make automation painful.

**2. Inform, don't overwhelm**
Show what's happening, show when it's done, show what to do next. Nothing else.

**3. Respect time**
Anything over 1 second needs a spinner. Anything with a known count needs a progress bar. Never leave users staring at a blank cursor.

**4. Color is semantic, not decorative**
- 🟢 Green → success, complete
- 🔴 Red → error, failed, blocked
- 🟡 Yellow → warning, requires attention
- ⬜ Dim/gray → secondary info, timestamps, metadata

**5. Dangerous actions default to No**
Y/N prompts for destructive operations must default to `N`. Never surprise a user into data loss.

**6. Be composable**
Errors go to `stderr`. Data goes to `stdout`. Exit codes are meaningful (0 = success, 1 = error, 2 = misuse). Scripts can rely on Job Finder without babysitting it.

---

## Components

### Welcome Screen

Show on launch when TTY is attached. Skip entirely when piped or called with `--quiet`.

**What to show:**
- Product name + version (small, not a billboard)
- Quick status: last run, jobs in DB, high-signal count
- Active sources count
- One-line hint for what to do next

**What not to show:**
- Documentation, instructions, feature lists
- Anything requiring scrolling to get past
- Spinners or loading states before content is ready

**Concrete recommendation:**

```
  ┌─────────────────────────────────────────┐
  │  Job Finder  v1.2.0                     │
  │                                         │
  │  Last run: 2 hours ago                  │
  │  Pipeline: 312 jobs  ·  14 high signal  │
  │  Sources:  6 active                     │
  │                                         │
  │  npm run run       Refresh pipeline     │
  │  npm run review    Open dashboard       │
  └─────────────────────────────────────────┘
```

- Border: single-line box drawing characters (─ │ ┌ ┐ └ ┘)
- Width: fixed at 45 chars — fits 80-column terminals comfortably
- Color: product name in bold white, values in cyan, hints in dim gray
- Show only once per session, not on every subcommand

---

### ASCII Art / Agent Icon

**Recommendation: a small wordmark, not a full banner**

Full ASCII art banners (figlet-style) look impressive the first time and become noise by the third. Reserve them for `--version` or `npm run welcome`.

For the persistent identity, use a compact 3-line wordmark:

```
  ╔═╗  Job Finder
  ║ ║  Your agent for the job market
  ╚═╝
```

**Stretch goal — animated agent icon:**
Inspired by GitHub Copilot CLI's animated banner and Claude's custom ASCII spinner. A 2-character animated agent presence that runs during long operations signals "I'm working" without the visual noise of a full spinner line.

```
  ⟨◈⟩  Capturing LinkedIn...
  ⟨◈⟩  Capturing Indeed...
```

Rotate the inner character (`◈ → ◉ → ◎ → ◈`) at 120ms intervals during async work. Static when idle. This is the "persistent agent icon" — a visual identity that stays consistent across all loading states.

**Implementation:** render as a stateful Ink component so the icon animates independently of log output.

---

### Loading Animations

**Rule:** match the animation to what you know.

| Situation | Pattern | Example |
|---|---|---|
| Unknown duration | Spinner | Connecting to bridge... |
| Known count | Step list with live status | Capturing 1 of 6 sources |
| Long operation | Progress bar + ETA | Scoring 847 jobs ━━━━━╸ 58% |
| Sub-second | Nothing | Don't add noise to fast ops |

**Spinner spec:**
Use braille dot patterns — they're the most fluid and widely supported:
`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` at 80ms per frame.
Fall back to `- \ | /` if non-UTF8 terminal detected.

**Step list for pipeline runs — the core Job Finder pattern:**

```
  ⠹  LinkedIn Saved Search      capturing...
  ✓  Indeed Remote Jobs         47 jobs  (2.1s)
  ✓  Wellfound                  23 jobs  (1.4s)
  ✗  Ashby                      failed — bridge not running
  ·  Built In                   waiting
  ·  Google Jobs                waiting
```

Rules:
- Each source gets one line, updated in place
- Spinner on active, ✓ on complete, ✗ on error, · on pending
- Show job count and elapsed time on completion
- Errors show actionable reason, not a stack trace
- On completion, collapse to a summary line:

```
  ✓  Pipeline complete  ·  70 new jobs  ·  1 error  ·  4.8s
```

**Never clear the screen** during a run. Users need to scroll up to debug errors.

---

### Y/N Prompts

**Core rules from clig.dev:**
- Show the default answer capitalized: `Continue? [y/N]` (default No) or `[Y/n]` (default Yes)
- Accept Enter alone to confirm the default
- Destructive actions always default to `N`
- Add `--yes` / `-y` flag to every prompt for non-interactive/script use
- If the action is irreversible, require typing the word `delete` or resource name, not just Y

**Concrete patterns by context:**

```
  Delete 47 stale jobs? [y/N]            → default No (destructive)
  Open dashboard in browser? [Y/n]       → default Yes (helpful, reversible)
  Reset all scores? Type "reset" to confirm: → irreversible, require word
```

**Style:**
- Question in white, `[y/N]` in dim gray
- Cursor sits immediately after the bracket, no extra space
- On selection, replace the prompt with a one-line summary:
  ```
  ✓  Deleted 47 stale jobs
  ```

**Never use Y/N for:**
- Account actions, authentication, payments — show a clear explanation and require explicit input
- Multi-option decisions — use a select list instead

---

### Interactive Selects / Clickable Elements

Terminals increasingly support [OSC 8 hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) — clickable URLs rendered as blue underlined text in modern terminal emulators (iTerm2, Terminal.app, VS Code, Warp).

**Use OSC 8 for:**
- Job URLs in output (`Open →` linked to the actual posting)
- Source URLs in the sources list
- Dashboard URL on `npm run review` launch: `Dashboard running at http://127.0.0.1:4311`

**For multi-option interaction, use arrow-key select lists:**

```
  What would you like to do?

  ❯ Run full pipeline
    Run single source
    Open dashboard
    Edit configuration
    Exit
```

Rules:
- Highlight selected item in bold/cyan, others in default
- Show cursor `❯` on active item
- Accept Enter to confirm, Escape to cancel
- Always offer an Exit/Cancel option
- Collapse to a one-line summary on selection

---

### Completion Summary

The moment users care most about. Every pipeline run should end with a scannable 3-line summary:

```
  ✓  Pipeline complete

     312 total  ·  47 new  ·  14 high signal  ·  3 errors

     npm run review    to open dashboard
```

- Line 1: status (success / partial / failed)
- Line 2: numbers that matter, in priority order
- Line 3: exactly one next action
- Errors get a separate block below if count > 0:

```
  ⚠  3 sources failed

     Ashby           bridge not running — start with: npm run bridge
     LinkedIn (2)    rate limit — retry in 10 minutes
```

---

### Error Messages

Follow clig.dev's three-part structure:

```
  Error: Could not connect to browser bridge

  The bridge server isn't running. Job Finder needs an active
  browser session to capture from LinkedIn and Wellfound.

  Start the bridge:   npm run bridge
  Or use snapshots:   npm run capture -- linkedin --snapshot
```

1. **Label**: `Error:` in red bold. Not "ERROR" or "Uh oh!"
2. **Context**: one sentence, plain English, what went wrong
3. **Resolution**: at least one concrete next step

Never print a stack trace to users. Log it to a file, show the path.

---

## Implementation Stack

**Recommended: [Ink](https://github.com/vadimdemedes/ink) (React for CLIs)**

Job Finder is already Node.js. Ink is the right layer — Gatsby, Shopify, and Parcel all use it. Write JSX, Ink handles terminal rendering, flexbox layout, and re-renders.

Key packages:

| Package | Purpose |
|---|---|
| `ink` | Core renderer |
| `@inkjs/ui` | Spinner, Select, TextInput, ProgressBar components |
| `chalk` | Color/style strings outside Ink components |
| `figures` | Cross-platform symbols (✓ ✗ ⚠ → ·) |
| `terminal-link` | OSC 8 clickable hyperlinks with fallback |
| `is-interactive` | Detect TTY vs piped — gate all animation on this |

**Non-negotiable:** gate every spinner, color, and interactive element behind `is-interactive()`. CI systems, scripts, and pipes get clean plain text output.

---

## Do / Don't Quick Reference

| Do | Don't |
|---|---|
| Animate only on TTY | Animate in piped output |
| Default destructive prompts to N | Default anything irreversible to Y |
| Show one next action on completion | List every possible command |
| Use ✓ ✗ ⚠ for status at a glance | Use words "SUCCESS" "FAILURE" "WARNING" |
| Collapse completed steps to a summary | Leave full step list expanded |
| Show job count + elapsed per source | Show raw HTTP logs |
| Errors to stderr, always | Mix errors into stdout |
| Provide `--quiet` and `--json` flags | Force interactive mode on automation |
| Show clickable URLs in supported terminals | Hardcode http:// strings without link support |
