import test from "node:test";
import assert from "node:assert/strict";

import {
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
  presentSearchStatus,
  readSearchRunCadence,
  resolveSearchesWelcomeToastScope,
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

test("computeSearchTotals rolls up counts and weighted avg score", () => {
  const totals = computeSearchTotals(
    [
      {
        capturedCount: 10,
        filteredCount: 3,
        dedupedCount: 2,
        importedCount: 5,
        expectedFoundCount: 6,
        hasUnknownExpectedCount: false,
        avgScore: 80,
      },
      {
        capturedCount: 12,
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
  assert.equal(totals.foundLabel, "8/10");
  assert.equal(totals.filtered, 5);
  assert.equal(totals.deduped, 3);
  assert.equal(totals.imported, 8);
  assert.equal(totals.avgScore, 73);
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

test("presentSearchStatus only exposes actionable auth-required details", () => {
  const authRequiredStatus = presentSearchStatus({
    enabled: true,
    authRequired: true,
    readiness: { key: "not_authorized" },
    captureStatus: "ready",
  });
  assert.equal(authRequiredStatus.label, "not authorized");
  assert.equal(authRequiredStatus.tone, "warn");
  assert.equal(authRequiredStatus.statusDetail, "Sign in to this source, then run Check access from More.");

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
