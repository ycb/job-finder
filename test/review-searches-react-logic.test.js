import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchOverflowActions,
  SEARCH_RUN_CADENCE_KEY,
  SEARCHES_WELCOME_TOAST_SEEN_KEY,
  buildSearchRows,
  computeSearchTotals,
  formatDurationFromNow,
  formatRelativeTimestamp,
  hasSeenSearchesWelcomeToast,
  markSearchesWelcomeToastSeen,
  normalizeRunCadence,
  normalizeSearchState,
  onboardingReadinessState,
  persistSearchRunCadence,
  presentSearchPrimaryAction,
  presentSearchStatus,
  readSearchRunCadence,
  resolveSearchesWelcomeToastScope,
  sourceKindFromType,
  sourceKindLabel,
  shouldShowSearchesWelcomeToast,
  splitSearchRows,
} from "../src/review/web/src/features/searches/logic.js";

function makeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("normalize helpers default to expected values", () => {
  assert.equal(normalizeSearchState("enabled"), "enabled");
  assert.equal(normalizeSearchState("DISABLED"), "disabled");
  assert.equal(normalizeSearchState("wat"), "enabled");

  assert.equal(normalizeRunCadence("daily"), "daily");
  assert.equal(normalizeRunCadence("WEEKLY"), "weekly");
  assert.equal(normalizeRunCadence("x"), "12h");
});

test("onboarding readiness distinguishes disabled, ready, and not authorized", () => {
  const disabled = onboardingReadinessState({ id: "a", enabled: false, authRequired: false }, {});
  assert.equal(disabled.key, "disabled");

  const readyNoAuth = onboardingReadinessState({ id: "b", enabled: true, authRequired: false }, {});
  assert.equal(readyNoAuth.key, "ready");

  const readyAuth = onboardingReadinessState(
    { id: "c", enabled: true, authRequired: true },
    { c: { status: "pass" } },
  );
  assert.equal(readyAuth.key, "ready");

  const warnAuth = onboardingReadinessState(
    { id: "d", enabled: true, authRequired: true },
    { d: { status: "warn" } },
  );
  assert.equal(warnAuth.key, "not_authorized");
});

test("buildSearchRows sorts by source kind and splitSearchRows counts enabled/disabled", () => {
  const rows = buildSearchRows(
    [
      {
        id: "google",
        name: "Google",
        type: "google_search",
        searchUrl: "https://google.example",
        enabled: true,
        authRequired: false,
      },
      {
        id: "linkedin",
        name: "LinkedIn",
        type: "linkedin_capture_file",
        searchUrl: "https://linkedin.example",
        enabled: true,
        authRequired: true,
      },
      {
        id: "indeed",
        name: "Indeed",
        type: "indeed_search",
        searchUrl: "https://indeed.example",
        enabled: false,
        authRequired: false,
      },
    ],
    {
      linkedin: { status: "warn" },
    },
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["linkedin", "indeed", "google"],
  );

  assert.equal(rows[0].readiness.key, "not_authorized");
  assert.equal(rows[1].readiness.key, "disabled");

  const { enabledRows, disabledRows } = splitSearchRows(rows);
  assert.equal(enabledRows.length, 2);
  assert.equal(disabledRows.length, 1);
});

test("YC Jobs and Levels.fyi are recognized as first-class source kinds", () => {
  assert.equal(sourceKindFromType("levelsfyi_search"), "lf");
  assert.equal(sourceKindFromType("yc_jobs"), "yc");
  assert.equal(sourceKindLabel("lf"), "Levels.fyi");
  assert.equal(sourceKindLabel("yc"), "YC Jobs");

  const rows = buildSearchRows(
    [
      {
        id: "levels",
        name: "",
        type: "levelsfyi_search",
        searchUrl: "https://levels.example",
        enabled: true,
        authRequired: false,
      },
      {
        id: "yc",
        name: "",
        type: "yc_jobs",
        searchUrl: "https://yc.example",
        enabled: true,
        authRequired: true,
      },
      {
        id: "builtin",
        name: "",
        type: "builtin_search",
        searchUrl: "https://builtin.example",
        enabled: true,
        authRequired: false,
      },
    ],
    {
      yc: { status: "warn" },
    },
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["builtin", "levels", "yc"],
  );

  const levelsRow = rows.find((row) => row.id === "levels");
  const ycRow = rows.find((row) => row.id === "yc");

  assert.equal(levelsRow?.kind, "lf");
  assert.equal(levelsRow?.label, "Levels.fyi");
  assert.equal(levelsRow?.readiness.key, "ready");

  assert.equal(ycRow?.kind, "yc");
  assert.equal(ycRow?.label, "YC Jobs");
  assert.equal(ycRow?.readiness.key, "not_authorized");
});

test("computeSearchTotals rolls up counts and weighted avg score", () => {
  const totals = computeSearchTotals(
    [
      {
        capturedCount: 10,
        foundCount: 10,
        filteredCount: 3,
        dedupedCount: 2,
        importedCount: 5,
        expectedFoundCount: 6,
        hasUnknownExpectedCount: false,
        avgScore: 80,
      },
      {
        capturedCount: 12,
        foundCount: 6,
        filteredCount: 2,
        dedupedCount: 1,
        importedCount: 3,
        expectedFoundCount: 4,
        hasUnknownExpectedCount: false,
        avgScore: 60,
      },
    ],
    "enabled",
  );

  assert.equal(totals.stateLabel, "Enabled Total");
  assert.equal(totals.foundLabel, "16");
  assert.equal(totals.filtered, 5);
  assert.equal(totals.deduped, 3);
  assert.equal(totals.imported, 8);
  assert.equal(totals.avgScore, 73);
});

test("computeSearchTotals rolls up latest trusted run deltas separately", () => {
  const totals = computeSearchTotals(
    [
      {
        foundCount: 34,
        filteredCount: 12,
        dedupedCount: 1,
        importedCount: 21,
        latestTrustedRunFoundCount: 8,
        latestTrustedRunFilteredCount: 3,
        latestTrustedRunDedupedCount: 0,
        latestTrustedRunImportedCount: 5,
        avgScore: 80,
      },
      {
        foundCount: 10,
        filteredCount: 4,
        dedupedCount: 2,
        importedCount: 4,
        latestTrustedRunFoundCount: 2,
        latestTrustedRunFilteredCount: 1,
        latestTrustedRunDedupedCount: 1,
        latestTrustedRunImportedCount: 0,
        avgScore: 60,
      },
    ],
    "enabled",
  );

  assert.equal(totals.latestTrustedRunFoundCount, 10);
  assert.equal(totals.latestTrustedRunFilteredCount, 4);
  assert.equal(totals.latestTrustedRunDedupedCount, 1);
  assert.equal(totals.latestTrustedRunImportedCount, 5);
});

test("buildSearchRows preserves explicit found counts", () => {
  const rows = buildSearchRows([
    {
      id: "builtin",
      name: "Built In",
      type: "builtin_search",
      searchUrl: "https://builtin.example",
      enabled: true,
      authRequired: false,
      filteredCount: 3,
      dedupedCount: 2,
      foundCount: 10,
      importedCount: 5,
    },
  ]);

  assert.equal(rows[0].foundCount, 10);
  assert.equal(presentSearchStatus(rows[0]).foundLabel, "10");
});

test("buildSearchRows preserves latest trusted run deltas separately from cumulative totals", () => {
  const rows = buildSearchRows([
    {
      id: "builtin",
      name: "Built In",
      type: "builtin_search",
      searchUrl: "https://builtin.example",
      enabled: true,
      authRequired: false,
      foundCount: 34,
      droppedByHardFilterCount: 12,
      droppedByDedupeCount: 1,
      importedCount: 21,
      latestTrustedRunFoundCount: 8,
      latestTrustedRunFilteredCount: 3,
      latestTrustedRunDedupedCount: 0,
      latestTrustedRunImportedCount: 5,
    },
  ]);

  assert.equal(rows[0].foundCount, 34);
  assert.equal(rows[0].filteredCount, 12);
  assert.equal(rows[0].dedupedCount, 1);
  assert.equal(rows[0].importedCount, 21);
  assert.equal(rows[0].latestTrustedRunFoundCount, 8);
  assert.equal(rows[0].latestTrustedRunFilteredCount, 3);
  assert.equal(rows[0].latestTrustedRunDedupedCount, 0);
  assert.equal(rows[0].latestTrustedRunImportedCount, 5);
});

test("buildSearchRows preserves unknown filtered and deduped history instead of coercing zeros", () => {
  const rows = buildSearchRows([
    {
      id: "builtin",
      name: "Built In",
      type: "builtin_search",
      searchUrl: "https://builtin.example",
      enabled: true,
      authRequired: false,
      importedCount: 5,
    },
  ]);

  assert.equal(rows[0].foundCount, null);
  assert.equal(rows[0].filteredCount, null);
  assert.equal(rows[0].dedupedCount, null);
  assert.equal(presentSearchStatus(rows[0]).foundLabel, "—");
});

test("presentSearchStatus prioritizes disabled state over capture readiness", () => {
  const disabledStatus = presentSearchStatus({
    enabled: false,
    captureStatus: "ready",
    refreshStatusReason: "eligible",
    refreshServedFrom: "live",
    importedCount: 0,
    expectedFoundCount: 0,
    hasUnknownExpectedCount: false,
    hasRunDelta: true,
    runNewCount: 0,
    runUpdatedCount: 0,
    runUnchangedCount: 0,
  });

  assert.equal(disabledStatus.label, "disabled");
  assert.equal(disabledStatus.tone, "muted");
});

test("presentSearchStatus does not expose cache as a user-facing status label", () => {
  const cachedReadyStatus = presentSearchStatus({
    enabled: true,
    captureStatus: "ready",
    hasCacheState: true,
  });

  assert.equal(cachedReadyStatus.label, "ready");
  assert.equal(cachedReadyStatus.tone, "ok");
});

test("presentSearchStatus folds legacy live_source rows into ready", () => {
  const legacyLiveSourceStatus = presentSearchStatus({
    enabled: true,
    captureStatus: "live_source",
    authRequired: false,
  });

  assert.equal(legacyLiveSourceStatus.label, "ready");
  assert.equal(legacyLiveSourceStatus.tone, "ok");
});

test("computeSearchTotals preserves unknown filtered and deduped totals", () => {
  const totals = computeSearchTotals(
    [
      {
        importedCount: 5,
        filteredCount: null,
        dedupedCount: null,
        foundCount: null,
        avgScore: 80,
      },
      {
        importedCount: 3,
        filteredCount: 2,
        dedupedCount: 1,
        foundCount: 6,
        avgScore: 60,
      },
    ],
    "enabled",
  );

  assert.equal(totals.foundLabel, "—");
  assert.equal(totals.filtered, null);
  assert.equal(totals.deduped, null);
  assert.equal(totals.imported, 8);
});

test("computeSearchTotals preserves unknown imported totals when any row lacks v2 data", () => {
  const totals = computeSearchTotals(
    [
      {
        importedCount: null,
        filteredCount: null,
        dedupedCount: null,
        foundCount: null,
        avgScore: null,
      },
      {
        importedCount: 3,
        filteredCount: 1,
        dedupedCount: 1,
        foundCount: 5,
        avgScore: 60,
      },
    ],
    "enabled",
  );

  assert.equal(totals.imported, null);
});

test("presentSearchStatus only exposes actionable auth-required details", () => {
  const authRequiredStatus = presentSearchStatus({
    enabled: true,
    authRequired: true,
    readiness: { key: "not_authorized" },
    captureStatus: "ready",
  });
  assert.equal(authRequiredStatus.label, "not authorized");
  assert.equal(authRequiredStatus.tone, "warn");
  assert.equal(authRequiredStatus.statusDetail, "Sign in to this source to continue.");

  const authRequiredFailedStatus = presentSearchStatus({
    enabled: true,
    authRequired: true,
    readiness: { key: "not_authorized" },
    captureStatus: "ready",
    lastAttemptedAt: "2026-03-31T20:00:00.000Z",
    lastAttemptOutcome: "transient_error",
    lastAttemptError: "Chrome AppleScript timed out after 15000ms",
  });
  assert.match(
    authRequiredFailedStatus.statusDetail,
    /^Sign in to this source to continue\. · Last attempt failed · Chrome AppleScript timed out after 15000ms · /
  );

  const nonActionableStatus = presentSearchStatus({
    enabled: true,
    authRequired: false,
    captureStatus: "ready",
    adapterHealthStatus: "failing",
    adapterHealthReason: "selector changed",
    formatterUnsupported: ["include_terms"],
    formatterNotes: ["stubbed"],
  });
  assert.equal(nonActionableStatus.label, "ready");
  assert.equal(nonActionableStatus.statusDetail, null);
  assert.equal(nonActionableStatus.formatterDetail, "");
});

test("presentSearchPrimaryAction promotes sign-in over run-now for auth-blocked sources", () => {
  const disabledAction = presentSearchPrimaryAction(
    { enabled: false },
    { controlsDisabled: false },
  );
  assert.deepEqual(disabledAction, {
    kind: "enable",
    label: "Enable",
    disabled: false,
  });

  const authBlockedAction = presentSearchPrimaryAction(
    {
      enabled: true,
      authRequired: true,
      readiness: { key: "not_authorized" },
      manualRefreshAllowed: true,
    },
    { controlsDisabled: false },
  );
  assert.deepEqual(authBlockedAction, {
    kind: "sign_in",
    label: "Sign in",
    disabled: false,
  });

  const coolingDownAction = presentSearchPrimaryAction(
    {
      enabled: true,
      authRequired: false,
      readiness: { key: "ready" },
      manualRefreshAllowed: false,
      manualRefreshNextEligibleAt: "2099-03-20T12:00:00.000Z",
    },
    { controlsDisabled: false },
  );
  assert.equal(coolingDownAction.kind, "run_now");
  assert.equal(coolingDownAction.disabled, true);
  assert.match(coolingDownAction.label, /^Available in /);
});

test("buildSearchOverflowActions keeps disable as an uncommon overflow action only", () => {
  assert.deepEqual(buildSearchOverflowActions({ enabled: false }), []);
  assert.deepEqual(buildSearchOverflowActions({ enabled: true }), [
    {
      kind: "disable",
      label: "Disable",
    },
  ]);
});

test("welcome toast + run cadence storage helpers persist values", () => {
  const storage = makeStorage();
  const scopeA = "scope-a";
  const scopeB = "scope-b";

  assert.equal(hasSeenSearchesWelcomeToast(storage, scopeA), false);
  markSearchesWelcomeToastSeen(storage, scopeA);
  assert.equal(hasSeenSearchesWelcomeToast(storage, scopeA), true);
  assert.equal(hasSeenSearchesWelcomeToast(storage, scopeB), false);
  assert.equal(storage.getItem(SEARCHES_WELCOME_TOAST_SEEN_KEY), scopeA);

  markSearchesWelcomeToastSeen(storage, scopeB);
  assert.equal(hasSeenSearchesWelcomeToast(storage, scopeB), true);
  assert.equal(storage.getItem(SEARCHES_WELCOME_TOAST_SEEN_KEY), scopeB);

  assert.equal(readSearchRunCadence(storage), "12h");
  const persisted = persistSearchRunCadence(storage, "daily");
  assert.equal(persisted, "daily");
  assert.equal(readSearchRunCadence(storage), "daily");
  assert.equal(storage.getItem(SEARCH_RUN_CADENCE_KEY), "daily");
});

test("resolveSearchesWelcomeToastScope uses onboarding timestamps", () => {
  assert.equal(resolveSearchesWelcomeToastScope(null), "global");
  assert.equal(
    resolveSearchesWelcomeToastScope({
      onboarding: { startedAt: "2026-03-11T10:00:00.000Z" },
    }),
    "2026-03-11T10:00:00.000Z",
  );
  assert.equal(
    resolveSearchesWelcomeToastScope({
      onboarding: {
        startedAt: "2026-03-11T10:00:00.000Z",
        sourcesConfiguredAt: "2026-03-11T11:00:00.000Z",
      },
    }),
    "2026-03-11T11:00:00.000Z",
  );
});

test("shouldShowSearchesWelcomeToast only allows first enabled searches visit", () => {
  assert.equal(
    shouldShowSearchesWelcomeToast({
      mainTab: "searches",
      searchState: "enabled",
      hasSeenToast: false,
    }),
    true,
  );

  assert.equal(
    shouldShowSearchesWelcomeToast({
      mainTab: "searches",
      searchState: "disabled",
      hasSeenToast: false,
    }),
    false,
  );

  assert.equal(
    shouldShowSearchesWelcomeToast({
      mainTab: "jobs",
      searchState: "enabled",
      hasSeenToast: false,
    }),
    false,
  );

  assert.equal(
    shouldShowSearchesWelcomeToast({
      mainTab: "searches",
      searchState: "enabled",
      hasSeenToast: true,
    }),
    false,
  );
});

test("time-format helpers are stable", () => {
  const now = Date.parse("2026-03-11T20:00:00.000Z");

  assert.equal(formatDurationFromNow("2026-03-11T20:45:00.000Z", now), "45m");
  assert.equal(formatDurationFromNow("2026-03-11T22:00:00.000Z", now), "2h");

  assert.equal(formatRelativeTimestamp("2026-03-11T19:40:00.000Z", now), "20m ago");
  assert.equal(formatRelativeTimestamp("2026-03-10T20:00:00.000Z", now), "1d ago");
});
