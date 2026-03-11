import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  isNarrataConnectEnabled,
  isRemoteOkEnabled,
  isWellfoundEnabled,
  renderDashboardPage
} from "../src/review/server.js";

test("isNarrataConnectEnabled defaults to false", () => {
  assert.equal(isNarrataConnectEnabled({}), false);
});

test("isNarrataConnectEnabled accepts common true values", () => {
  assert.equal(isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "1" }), true);
  assert.equal(
    isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "true" }),
    true
  );
  assert.equal(isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "yes" }), true);
  assert.equal(isNarrataConnectEnabled({ JOB_FINDER_ENABLE_NARRATA_CONNECT: "on" }), true);
});

test("renderDashboardPage sets narrataConnectEnabled=false by default", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const narrataConnectEnabled = false;"), true);
});

test("renderDashboardPage sets narrataConnectEnabled=true when enabled in options", () => {
  const html = renderDashboardPage({}, { narrataConnectEnabled: true });
  assert.equal(html.includes("const narrataConnectEnabled = true;"), true);
});

test("isWellfoundEnabled defaults to false", () => {
  assert.equal(isWellfoundEnabled({}), false);
});

test("isWellfoundEnabled accepts common true values", () => {
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "1" }), true);
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "true" }), true);
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "yes" }), true);
  assert.equal(isWellfoundEnabled({ JOB_FINDER_ENABLE_WELLFOUND: "on" }), true);
});

test("isRemoteOkEnabled defaults to false", () => {
  assert.equal(isRemoteOkEnabled({}), false);
});

test("isRemoteOkEnabled accepts common true values", () => {
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "1" }), true);
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "true" }), true);
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "yes" }), true);
  assert.equal(isRemoteOkEnabled({ JOB_FINDER_ENABLE_REMOTEOK: "on" }), true);
});

test("renderDashboardPage sets wellfoundEnabled=false by default", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const wellfoundEnabled = false;"), true);
});

test("renderDashboardPage sets wellfoundEnabled=true when enabled in options", () => {
  const html = renderDashboardPage({}, { wellfoundEnabled: true });
  assert.equal(html.includes("const wellfoundEnabled = true;"), true);
});

test("renderDashboardPage sets remoteokEnabled=false by default", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const remoteokEnabled = false;"), true);
});

test("renderDashboardPage sets remoteokEnabled=true when enabled in options", () => {
  const html = renderDashboardPage({}, { remoteokEnabled: true });
  assert.equal(html.includes("const remoteokEnabled = true;"), true);
});

test("renderDashboardPage emits valid inline script syntax", () => {
  const html = renderDashboardPage({});
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, "expected inline script tag in dashboard HTML");
  assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
});

test("renderDashboardPage makes Find Jobs the primary top-level action", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('id="save-search-criteria"'), true);
  assert.equal(html.includes('id="run-all"'), false);
  assert.equal(html.includes('id="refresh-data"'), false);
});

test("renderDashboardPage builds searches enabled/disabled tabs", () => {
  const html = renderDashboardPage({
    sources: [
      { id: "linkedin-a", name: "LinkedIn A", type: "linkedin_capture_file" },
      { id: "linkedin-b", name: "LinkedIn B", type: "linkedin_capture_file" },
      { id: "indeed-a", name: "Indeed A", type: "indeed_search" }
    ]
  });
  assert.equal(html.includes('data-search-state="enabled"'), true);
  assert.equal(html.includes('data-search-state="disabled"'), true);
  assert.equal(html.includes('class="searches-tabs-row"'), true);
  assert.equal(html.includes('class="card searches-card"'), true);
  assert.equal(html.includes('class="search-state-tabs"'), true);
  assert.equal(html.includes('class="search-state-tab\' +'), true);
  assert.equal(html.includes("const searchSources = (Array.isArray(dashboard.sources) ? dashboard.sources : [])"), true);
  assert.equal(html.includes("button.dataset.searchState"), true);
});

test("renderDashboardPage uses inline criteria status and prominent Find Jobs CTA", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('id="save-search-criteria"'), true);
  assert.equal(html.includes('class="primary cta-find-jobs'), true);
  assert.equal(html.includes('class="criteria-status'), true);
  assert.equal(html.includes("btn-spinner"), true);
  assert.equal(html.includes('id="jobs-feedback"'), false);
});

test("renderDashboardPage wires Find Jobs to run all sources", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('"/api/search-criteria"'), true);
  assert.equal(html.includes('"/api/sources/run-all"'), true);
});

test("renderDashboardPage source filter chips show active counts", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("All Results ("), true);
});

test("renderDashboardPage searches table uses compact status", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const droppedHardFilterCount = Number(source.droppedByHardFilterCount || 0);"), false);
  assert.equal(html.includes("const importedThisCaptureCount = Number(source.keptAfterDedupeCount || 0);"), false);
  assert.equal(html.includes("= imported "), false);
  assert.equal(html.includes("db total "), false);
});

test("renderDashboardPage searches table row opens Jobs selected source and icon opens external search", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("class=\"search-url\""), false);
  assert.equal(html.includes("data-open-jobs-row"), true);
  assert.equal(html.includes("search-name-link"), true);
  assert.equal(html.includes("target=\"_blank\""), true);
  assert.equal(html.includes("data-stop-row-open=\"1\""), true);
  assert.equal(html.includes("data-open-search-url"), false);
  assert.equal(html.includes("window.open(url, \"_blank\", \"noopener,noreferrer\")"), false);
  assert.equal(html.includes("setSourceFilter(sourceKind);"), true);
  assert.equal(html.includes("data-run-source-kind"), false);
});

test("renderDashboardPage status uses cache-tone dot affordance", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("class=\"status-dot\""), true);
  assert.equal(html.includes("data-tone=\""), true);
  assert.equal(html.includes("statusTone"), true);
});

test("renderDashboardPage hides manual Add Search affordances in automated mode", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes('id="open-add-source"'), false);
  assert.equal(html.includes("Filter by source, review freshness, and focus on where high-signal jobs come from."), false);
});

test("renderDashboardPage renders searches source-state controls with overflow actions", () => {
  const html = renderDashboardPage({
    featureFlags: { onboardingWizard: true },
    onboarding: {
      completed: false,
      consentComplete: true,
      consent: {
        termsAccepted: true,
        privacyAccepted: true,
        tosRiskAccepted: true
      },
      selectedSourceIds: [],
      checks: { sources: {} }
    },
    sources: [
      {
        id: "linkedin-live-capture",
        name: "LinkedIn",
        type: "linkedin_capture_file",
        authRequired: true,
        enabled: false
      },
      {
        id: "builtin-sf-ai-pm",
        name: "Built In",
        type: "builtin_search",
        authRequired: false,
        enabled: true
      }
    ]
  });

  assert.equal(html.includes("Enabled ("), true);
  assert.equal(html.includes("Disabled ("), true);
  assert.equal(html.includes("Issue detected"), true);
  assert.equal(html.includes("Authentication required"), true);
  assert.equal(
    html.includes("const searchesPageSections = searchesSection + searchesWelcomeToastMarkup;"),
    true
  );
  assert.equal(html.includes('id="onboarding-save-consent"'), true);
  assert.equal(html.includes("data-onboarding-enable-source"), true);
  assert.equal(html.includes('data-onboarding-check-source="'), true);
  assert.equal(html.includes('data-onboarding-open-source="'), false);
  assert.equal(html.includes("onboarding-overflow-menu"), true);
  assert.equal(html.includes("data-onboarding-disable-source"), true);
  assert.equal(html.includes('id="onboarding-go-jobs"'), false);
  assert.equal(html.includes("const searchesPageSections ="), true);
  assert.equal(html.includes("onboardingCard,"), false);
  assert.equal(html.includes("Install Channel"), false);
  assert.equal(html.includes('id="onboarding-analytics-enabled"'), false);
  assert.equal(html.includes('id="profile-analytics-enabled"'), true);
  assert.equal(html.includes("captured during CLI setup (jf init)"), false);
  assert.equal(html.includes("verifySingleOnboardingSource"), true);
  assert.equal(html.includes("authProbe: authRequired"), true);
  assert.equal(html.includes("enableOnboardingSource"), true);
  assert.equal(html.includes("recoverAuthForSources"), true);
  assert.equal(html.includes('id="search-run-cadence"'), true);
  assert.equal(html.includes('selectedSearchStateFilter === "enabled"'), true);
});

test("renderDashboardPage shows enabled-tab onboarding welcome toast with disabled-tab CTA", () => {
  const html = renderDashboardPage({
    featureFlags: { onboardingWizard: true },
    onboarding: {
      completed: false,
      consentComplete: true,
      consent: {
        termsAccepted: true,
        privacyAccepted: true,
        tosRiskAccepted: true
      },
      checks: { sources: {} }
    },
    sources: [
      {
        id: "linkedin-live-capture",
        name: "LinkedIn",
        type: "linkedin_capture_file",
        authRequired: true,
        enabled: true
      },
      {
        id: "builtin-sf-ai-pm",
        name: "Built In",
        type: "builtin_search",
        authRequired: false,
        enabled: true
      }
    ]
  });

  assert.equal(
    html.includes("Welcome to Job Finder!"),
    true
  );
  assert.equal(
    html.includes(
      "The Enabled tab shows websites with public job postings. To enable sources like LinkedIn (where login is required) visit the Disabled tab."
    ),
    true
  );
  assert.equal(html.includes('data-search-welcome-disabled="1"'), true);
  assert.equal(html.includes('data-search-welcome-dismiss="1"'), true);
  assert.equal(
    html.includes('aria-label="Close welcome message"'),
    true
  );
  assert.equal(html.includes(">Dismiss<"), false);
});

test("renderDashboardPage persists first-visit state key for searches welcome toast", () => {
  const html = renderDashboardPage({
    featureFlags: { onboardingWizard: true },
    onboarding: {
      completed: false,
      consentComplete: true,
      consent: {
        termsAccepted: true,
        privacyAccepted: true,
        tosRiskAccepted: true
      },
      checks: { sources: {} }
    }
  });

  assert.equal(
    html.includes("jobFinder.searchesWelcomeToastSeen.v2"),
    true
  );
  assert.equal(
    html.includes("onboardingIncomplete &&"),
    false
  );
  assert.equal(html.includes('data-search-welcome-dismiss="1"'), true);
});

test("renderDashboardPage keeps overflow menu off disabled rows", () => {
  const html = renderDashboardPage({
    featureFlags: { onboardingWizard: true },
    onboarding: {
      completed: false,
      consentComplete: true,
      consent: {
        termsAccepted: true,
        privacyAccepted: true,
        tosRiskAccepted: true
      },
      checks: { sources: {} }
    },
    sources: [
      {
        id: "linkedin-live-capture",
        name: "LinkedIn",
        type: "linkedin_capture_file",
        authRequired: true,
        enabled: false
      }
    ]
  });

  assert.equal(
    html.includes('const overflowMenu = source.enabled'),
    true
  );
});

test("renderDashboardPage blocks access with legal interstitial until consent is complete", () => {
  const html = renderDashboardPage({
    featureFlags: { onboardingWizard: true },
    onboarding: {
      completed: false,
      consentComplete: false,
      consent: {
        termsAccepted: false,
        privacyAccepted: false,
        tosRiskAccepted: false
      },
      selectedSourceIds: [],
      checks: { sources: {} }
    }
  });

  assert.equal(
    html.includes("To access JobFinder, review and accept the following:"),
    true
  );
  assert.equal(html.includes("/policy/terms"), true);
  assert.equal(html.includes("/policy/privacy"), true);
  assert.equal(
    html.includes("I understand some platforms restrict automated access from logged-in users and accept responsibility for my accounts."),
    true
  );
  assert.equal(html.includes("app.innerHTML = consentGateRequired"), true);
  assert.equal(html.includes('id="onboarding-save-consent"'), true);
  assert.equal(html.includes("Agree and Continue"), true);
});

test("renderDashboardPage includes default non-auth onboarding selection fallback", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("defaultOnboardingSelection(onboardingCandidateSources())"), true);
});

test("renderDashboardPage first-run onboarding selection prefers no-auth defaults", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const isFirstRunSelection ="), true);
  assert.equal(html.includes("!onboarding.firstRunAt"), true);
  assert.equal(html.includes("!hasConfiguredSources"), true);
  assert.equal(html.includes("return defaultOnboardingSelection(onboardingCandidateSources());"), true);
  assert.equal(html.includes("if (hasConfiguredSources)"), true);
  assert.equal(html.includes("return [];"), true);
});

test("renderDashboardPage searches table shows funnel columns", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("<th>Found</th>"), true);
  assert.equal(html.includes("<th>Filtered</th>"), true);
  assert.equal(html.includes("<th>Dupes</th>"), true);
  assert.equal(html.includes("<th>Imported</th>"), true);
  assert.equal(html.includes("<th>Avg Score</th>"), true);
  assert.equal(html.includes("<th>Captured</th>"), false);
  assert.equal(html.includes("<th>Filtered Out</th>"), false);
  assert.equal(html.includes("<th>Deduped Out</th>"), false);
  assert.equal(html.includes("<th>Applied</th>"), false);
  assert.equal(html.includes("<th>Skipped</th>"), false);
  assert.equal(html.includes("<th>High Signal</th>"), false);
  assert.equal(html.includes("<th>Jobs Found</th>"), false);
});

test("renderDashboardPage computes Found as imported-over-expected ratio", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const foundLabel ="), true);
  assert.equal(html.includes("source.hasUnknownExpectedCount"), true);
  assert.equal(html.includes('String(source.importedCount) + "/?"'), true);
  assert.equal(
    html.includes(
      "String(source.importedCount) +"
    ),
    true
  );
  assert.equal(
    html.includes("String(Math.max(0, Math.round(source.expectedFoundCount)))"),
    true
  );
});

test("renderDashboardPage includes bold totals row for the active searches tab", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("filteredSearchSources.length > 0"),
    true
  );
  assert.equal(html.includes('class="search-totals-row"'), true);
  assert.equal(html.includes("Enabled Total"), true);
});

test("renderDashboardPage computes filtered and deduped as dropped counts", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("filteredCount: Number(source.droppedByHardFilterCount || 0)"),
    true
  );
  assert.equal(
    html.includes("dedupedCount: Number(source.droppedByDedupeCount || 0)"),
    true
  );
});

test("renderDashboardPage computes imported from source import totals", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("importedCount: Number(source.importedCount || 0)"),
    true
  );
  assert.equal(html.includes("accumulator.imported += Number(source.importedCount || 0);"), true);
});

test("renderDashboardPage weights avg score by imported count", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("source.avgScore === null || source.avgScore === undefined"),
    true
  );
  assert.equal(
    html.includes("accumulator.avgScoreTotal +="),
    true
  );
  assert.equal(html.includes("Number(source.avgScore) * Number(source.importedCount || 0)"), true);
  assert.equal(html.includes("accumulator.avgScoreCount += Number(source.importedCount || 0);"), true);
});

test("renderDashboardPage groups jobs source filters by source kind", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("const sourceFilterTotals = new Map();"), true);
  assert.equal(html.includes("data-filter-source=\"' + escapeHtml(sourceFilter.kind)"), true);
});

test("renderDashboardPage marks jobs viewed from active queue payload", () => {
  const html = renderDashboardPage({});
  assert.equal(
    html.includes("const target = (dashboard.queue || []).find((item) => item.id === jobId);"),
    true
  );
  assert.equal(
    html.includes("Array.isArray(dashboard?.queue) ? dashboard.queue : []"),
    true
  );
  assert.equal(html.includes("Array.isArray(dashboard?.jobs) ? dashboard.jobs : []"), false);
});

test("renderDashboardPage surfaces formatter diagnostics in searches status detail", () => {
  const html = renderDashboardPage({
    sources: [
      {
        id: "builtin-ai",
        name: "Built In AI",
        type: "builtin_search",
        searchUrl: "https://www.builtinsf.com/jobs",
        enabled: true,
        capturedAt: "2026-03-08T00:00:00.000Z",
        captureStatus: "ready",
        captureJobCount: 10,
        droppedByHardFilterCount: 2,
        droppedByDedupeCount: 1,
        importedCount: 7,
        formatterDiagnostics: {
          unsupported: ["minSalary"],
          notes: ["distance filter not supported"]
        },
        criteriaAccountability: {
          appliedInUrl: ["title", "keywords", "location", "datePosted"],
          appliedInUiBootstrap: [],
          appliedPostCapture: [],
          unsupported: ["minSalary"]
        }
      }
    ]
  });

  assert.equal(html.includes("source.formatterDiagnostics"), true);
  assert.equal(html.includes("formatterUnsupported"), true);
  assert.equal(html.includes("formatterNotes"), true);
  assert.equal(html.includes("formatter:"), true);
  assert.equal(html.includes("distance filter not supported"), true);
});
