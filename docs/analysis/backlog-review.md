# Backlog Review - March 5, 2026

## Executive Summary

**Overall assessment:** Backlog is well-structured with detailed specs, but **priorities need reordering** based on user impact and strategic readiness.

**Key recommendations:**
1. Move **NPM publish** and **Full JD verification** to P0 (blocking adoption + quality)
2. Demote **Claude/Codex integrations** to P2 (niche use case, premature)
3. Add missing **documentation + troubleshooting** items (high ROI, low effort)
4. Clarify **onboarding source auth** scope (too broad for P0)

---

## Priority Assessment

### P0 Items (Critical Path)

#### ✅ KEEP P0: Onboarding source selection + per-source auth
**Current:** P0
**Reasoning:** Critical for automated runs, reduces support burden
**Issue:** Spec is too broad ("authentication readiness" is vague)
**Recommendation:**
- Split into two items:
  - **P0:** Basic source enablement in `jf init` (checkboxes for which sources to enable)
  - **P1:** Per-source auth readiness checks (Chrome AppleScript verification, etc.)

#### ⬆️ PROMOTE TO P0: Full JD verification pass
**Current:** P0 (nested under onboarding in formatting)
**Issue:** Listed as P0 but buried, needs elevation
**Reasoning:**
- **High impact:** Directly improves shortlist quality (fewer false positives)
- **Blocks quality:** Snippet-only text is causing noise in production
- **User-facing:** Bad results erode trust in scoring system
**Recommendation:** Make this a standalone P0, not nested

#### ⬆️ PROMOTE TO P0: NPM publish
**Current:** P1
**Reasoning:**
- **Blocks adoption:** Repo-clone friction is #1 barrier to new users
- **Low effort:** Package.json already configured, just needs publish checklist
- **High ROI:** Unlocks `npx job-finder`, standard install flow
- **Prerequisite:** Must happen before Homebrew (P1)
**Recommendation:** Move to P0, do this first

---

### P1 Items (Next Release)

#### ✅ KEEP P1: Formatter diagnostics persistence
**Current:** P1
**Reasoning:** Transparency issue, but not blocking daily use
**Effort:** Low-medium, good P1 candidate

#### ✅ KEEP P1: Improve `jf init`
**Current:** P1
**Reasoning:** Onboarding friction is real, but workarounds exist (manual config)
**Caveat:** LinkedIn auto-extract is brittle (platform changes break it)
**Recommendation:** Focus on prompts for basic fields (title, location, salary) over auto-extraction

#### ✅ KEEP P1: Homebrew publish
**Current:** P1
**Reasoning:** Good follow-on to NPM publish, but not critical path
**Dependency:** Requires NPM publish first (correctly noted)

#### ⬇️ DEMOTE TO P2: Claude Code skill
**Current:** P1
**Reasoning:**
- **Niche use case:** Only benefits Claude Code users (subset of CLI users)
- **Premature:** Core product not yet widely distributed
- **Low demand signal:** No user requests for this yet
- **Effort:** Medium (skill authoring, testing, maintenance)
**Recommendation:** Move to P2, revisit after NPM publish + user feedback

#### ⬇️ DEMOTE TO P2: Codex MCP server
**Current:** P1
**Reasoning:** Same as Claude skill - premature optimization for integration layer
**Recommendation:** Move to P2

#### ❓ CLARIFY: Narrata sync stabilization
**Current:** P1
**Issue:** "Operationally inconsistent" is vague
**Questions:**
- Is this blocking any users?
- What % of users use Narrata vs `profile.json`?
- What are specific failure modes?
**Recommendation:** Either add clearer acceptance criteria or demote to P2 if low usage

#### ✅ KEEP P1: Greenhouse source
**Current:** P1
**Reasoning:** Major ATS family, expands coverage meaningfully
**Caveat:** Requires portal abstraction refactor (medium effort)

---

### P2 Items (Future Enhancements)

#### ✅ KEEP P2: Wellfound criteria bootstrap
**Current:** P2
**Reasoning:** Wellfound works as-is (manual URL), criteria stub is known limitation
**Effort:** Medium-high (UI automation complexity)

#### ✅ KEEP P2: RemoteOK validation
**Current:** P2
**Reasoning:** Feature-flagged, not blocking, good P2

#### ✅ KEEP P2: Y Combinator source
**Current:** P2
**Reasoning:** Nice-to-have, not critical coverage gap

#### ❓ RECONSIDER: Remove Searches page
**Current:** P2
**Issue:** This feels premature
**Questions:**
- Is auto-construct mature enough to remove manual controls?
- What if users want to manually edit source URLs?
- What's the maintenance burden of keeping it?
**Recommendation:** Keep as P2, but validate with user feedback first

---

## Missing Items (Gaps)

### Critical Missing (Should be P0/P1)

#### 📝 ADD P0: Troubleshooting documentation
**Why missing:** Common issues (database locked, port conflicts, Chrome settings) are scattered
**Impact:** Reduces support burden, improves first-run success
**Effort:** Low (extract from INSTALL.md, add FAQ section)
**Recommendation:** Add as P0 or early P1

#### 📝 ADD P1: Error handling + diagnostics
**Why missing:** Backlog has "formatter diagnostics" but not general error visibility
**Scope:**
- Capture failures surface in dashboard (not silent)
- Bridge connection status visible before run
- Source health checks (`jf sources --check`)
**Impact:** Reduces "it didn't work" support tickets
**Effort:** Medium
**Recommendation:** Add as P1 under Core Functionality theme

#### 📝 ADD P1: Example configs + inline documentation
**Why missing:** Example files exist but lack comments explaining each field
**Scope:**
- Add inline comments to `*.example.json` files
- Create "Common Setups" guide (PM search, SWE search, Remote-only, etc.)
**Impact:** Reduces onboarding confusion
**Effort:** Low
**Recommendation:** Add as P1 under Onboarding theme

### Nice-to-Have Missing (P2 candidates)

#### 📝 CONSIDER P2: GitHub releases automation
**Scope:** Auto-generate release notes from commits, tag releases
**Impact:** Professional distribution, easier changelog tracking
**Effort:** Low (GitHub Actions)

#### 📝 CONSIDER P2: First-run sample data
**Scope:** Seed database with 5-10 example jobs on `jf init`
**Impact:** Reduces "empty dashboard" confusion
**Effort:** Low (static JSON fixture)

---

## Items to Remove

### ❌ REMOVE: Integration items until post-launch
**Items:**
- Claude Code skill (currently P1)
- Codex MCP server (currently P1)

**Reasoning:**
- Core product not yet distributed (NPM publish pending)
- No user demand signals yet
- Integration layer is premature optimization
- Better to focus on core quality + adoption first

**Recommendation:**
- Remove from active backlog
- Move to `Future Considerations` section
- Revisit after NPM publish + 3 months user feedback

---

## Recommended Reprioritization

### Revised P0 (Critical Path - Next 2 Weeks)

1. **NPM publish** (moved up from P1)
   - *Impact:* Unlocks adoption, standard install flow
   - *Effort:* Low (1-2 days)
   - *Blocks:* Homebrew publish, wider distribution

2. **Full JD verification pass** (elevated from nested P0)
   - *Impact:* Improves shortlist quality, reduces false positives
   - *Effort:* Medium (3-5 days including Built In salary scrape)
   - *Risk:* Adds latency to capture flow

3. **Troubleshooting documentation** (new item)
   - *Impact:* Reduces support burden, improves first-run success
   - *Effort:* Low (1 day)
   - *Quick win:* High ROI for low effort

4. **Onboarding source enablement** (split from current P0)
   - *Impact:* Clearer setup, fewer failed runs
   - *Effort:* Low-medium (2-3 days)
   - *Scope:* Just enable/disable checkboxes, not auth checks

### Revised P1 (Next Release - 4-6 Weeks)

1. **Formatter diagnostics persistence** (keep)
2. **Improve `jf init` with prompts** (keep, but focus on prompts not auto-extract)
3. **Homebrew publish** (keep, after NPM)
4. **Error handling + diagnostics** (new item)
5. **Example configs + inline docs** (new item)
6. **Greenhouse source** (keep)
7. **Per-source auth readiness checks** (split from P0)
8. **Narrata sync stabilization** (keep if usage is significant, else demote)

### Revised P2 (Future - 2-3 Months)

1. **Wellfound criteria bootstrap** (keep)
2. **RemoteOK validation** (keep)
3. **Y Combinator source** (keep)
4. **Claude Code skill** (demoted from P1)
5. **Codex MCP server** (demoted from P1)
6. **Remove Searches page** (keep, pending validation)
7. **GitHub releases automation** (new item)
8. **First-run sample data** (new item)

---

## Theme Rebalancing

**Current themes:** Core Functionality, Onboarding, Distribution, Integrations, Source Expansion, Source Quality, UX Simplification

**Recommended changes:**

1. **Add "Documentation" theme** - Missing entirely, should be explicit
2. **Add "Error Handling" theme** - Diagnostics scattered across Core/Onboarding
3. **Reduce "Integrations" theme** - Demote Claude/Codex to P2, focus on core first
4. **Expand "Distribution" theme** - Add troubleshooting, release automation

---

## Action Items

### Immediate (This Week)

1. ✅ Move NPM publish to P0
2. ✅ Elevate Full JD verification to standalone P0
3. ✅ Add Troubleshooting docs as P0/P1
4. ✅ Split onboarding auth item (enablement P0, auth checks P1)

### Short-term (Next Sprint)

5. ✅ Demote Claude/Codex integrations to P2
6. ✅ Add Error handling + diagnostics to P1
7. ✅ Add Example configs + docs to P1
8. ✅ Clarify Narrata scope or demote to P2

### Review Cycle

9. ✅ Revisit integration items after NPM publish + user feedback
10. ✅ Validate "Remove Searches page" before implementation
11. ✅ Add "Future Considerations" section for deferred items

---

## Conclusion

**Backlog is well-structured** with good specs and themes, but **priorities don't match product readiness stage**.

**Key insight:** You're prioritizing integrations (Claude, Codex, Narrata) before the core product is distributed (NPM) or quality is proven (Full JD pass). This is backwards.

**Recommended sequence:**
1. **P0:** Distribute (NPM) + Fix Quality (Full JD) + Document (Troubleshooting)
2. **P1:** Polish Onboarding + Error Visibility + Examples
3. **P2:** Expand Sources + Integrations (after validation)

**This reordering aligns backlog with "ship public beta → gather feedback → iterate" strategy** from the product analysis.
