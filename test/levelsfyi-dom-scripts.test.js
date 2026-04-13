import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import zlib from "node:zlib";
import LZString from "lz-string";
import { parseHTML } from "linkedom";
import {
  buildLevelsFyiDomCaptureScript,
  buildLevelsFyiDomProbeScript,
  buildLevelsFyiDomScrollScript,
  buildLevelsFyiCompanyListScript,
  buildLevelsFyiCookieDismissScript,
  buildLevelsFyiSetMinCompScript,
  buildLevelsFyiSetDatePostedValueScript,
  buildLevelsFyiSelectFilterOptionScript,
  buildLevelsFyiListFilterOptionsScript,
  buildLevelsFyiPaginationInfoScript,
  buildLevelsFyiPaginationClickNextScript,
  buildLevelsFyiPaginationWaitScript,
  parseLevelsFyiDomTotalsFromHtml,
  nextLevelsFyiDomNoGrowthState,
  isLevelsFyiSearchReady,
  getLevelsFyiSearchInputValue,
  shouldApplyLevelsFyiSearchText,
  decodeLevelsFyiApiPayload,
  mergeLevelsFyiJobsById,
  capturePaginatedJobsWithNavigator,
  shouldPaginateLevels
} from "../src/browser-bridge/providers/chrome-applescript.js";

function createDomContext(html) {
  const { document, window } = parseHTML(html);
  const KeyboardEventShim =
    window.KeyboardEvent ||
    function KeyboardEvent(type, init = {}) {
      const evt = new window.Event(type, init);
      evt.key = init.key;
      return evt;
    };
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  const context = vm.createContext({
    document,
    window,
    Event: window.Event,
    KeyboardEvent: KeyboardEventShim,
    URL,
    location: { origin: "https://www.levels.fyi", href: "https://www.levels.fyi/jobs" }
  });
  return { document, window, context };
}

test("Levels DOM capture scopes to companies list container", () => {
  const html = `
    <div class="jobs-directory-body-module-scss-module__XmM6sq__companiesListContainer">
      <div class="company-block">
        <div class="companyName">Alpha</div>
        <a href="/jobs?jobId=111"><div class="companyJobTitle">Staff PM <span class="companyJobDate">1 day ago</span></div><div class="companyJobLocation">San Francisco, CA · $210K</div></a>
        <a href="/jobs?jobId=222"><div class="companyJobTitle">PM AI <span class="companyJobDate">2 days ago</span></div><div class="companyJobLocation">San Francisco, CA · $220K</div></a>
      </div>
    </div>
    <div class="jobs-directory-body-module-scss-module__XmM6sq__jobDetailContainer">
      <div class="companyName">DetailCo</div>
      <a href="/jobs?jobId=999"><div class="companyJobTitle">Detail PM <span class="companyJobDate">2 days ago</span></div></a>
    </div>
  `;
  const script = buildLevelsFyiDomCaptureScript();
  const { context } = createDomContext(html);
  const result = vm.runInContext(script, context);
  const payload = JSON.parse(result);
  const ids = payload.jobs.map((job) => job.externalId).sort();
  assert.deepEqual(ids, ["111", "222"]);
});

test("Levels DOM scroll advances companies list container", () => {
  const html = `
    <div class="jobs-directory-body-module-scss-module__XmM6sq__companiesListContainer">
      <div class="companiesListScroller"></div>
    </div>
    <div class="jobs-directory-body-module-scss-module__XmM6sq__jobDetailContainer"></div>
  `;
  const script = buildLevelsFyiDomScrollScript();
  const { document, context } = createDomContext(html);
  const companies = document.querySelector("div[class*='companiesListContainer']");
  const inner = document.querySelector(".companiesListScroller");
  const detail = document.querySelector("div[class*='jobDetailContainer']");

  Object.defineProperty(companies, "scrollHeight", { value: 1200, configurable: true });
  Object.defineProperty(companies, "clientHeight", { value: 800, configurable: true });
  Object.defineProperty(inner, "scrollHeight", { value: 1200, configurable: true });
  Object.defineProperty(inner, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(detail, "scrollHeight", { value: 800, configurable: true });
  Object.defineProperty(detail, "clientHeight", { value: 400, configurable: true });

  Object.defineProperty(companies, "scrollTop", { value: 0, writable: true, configurable: true });
  Object.defineProperty(inner, "scrollTop", { value: 0, writable: true, configurable: true });
  Object.defineProperty(detail, "scrollTop", { value: 0, writable: true, configurable: true });

  const payload = JSON.parse(vm.runInContext(script, context));
  assert.ok(payload.pickedWithinCompaniesList, "expected scroll to stay within companies list");
  assert.ok(inner.scrollTop > 0, "expected companies list scroller to scroll");
  assert.equal(detail.scrollTop, 0, "expected detail container to remain untouched");
});

test("Levels DOM scroll uses job list ancestor when companies list is not scrollable", () => {
  const html = `
    <div class="jobs-directory-body-module-scss-module__XmM6sq__companiesListContainer"></div>
    <div class="jobListScroller">
      <a href="/jobs?jobId=111"><div class="companyJobTitle">Job</div></a>
    </div>
  `;
  const { document, context } = createDomContext(html);
  const script = buildLevelsFyiDomScrollScript();
  const scroller = document.querySelector(".jobListScroller");

  Object.defineProperty(scroller, "scrollHeight", { value: 1400, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true, configurable: true });

  const payload = JSON.parse(vm.runInContext(script, context));
  assert.equal(payload.pickedVia, "jobLinkAncestor");
  assert.ok(scroller.scrollTop > 0, "expected job list scroller to scroll");
});

test("Levels DOM scroll continues until stalled with no growth", () => {
  let state = { noGrowth: 0, stop: false };
  state = nextLevelsFyiDomNoGrowthState(state, 3, { prev: 0, next: 100 });
  assert.deepEqual(state, { noGrowth: 0, stop: false });

  state = nextLevelsFyiDomNoGrowthState(state, 0, { prev: 0, next: 200 });
  assert.deepEqual(state, { noGrowth: 0, stop: false });

  state = nextLevelsFyiDomNoGrowthState(state, 0, { prev: 200, next: 200 });
  assert.deepEqual(state, { noGrowth: 1, stop: false });

  state = nextLevelsFyiDomNoGrowthState(state, 0, { prev: 200, next: 200 });
  assert.deepEqual(state, { noGrowth: 2, stop: true });
});

test("Levels API payload decoder handles gzip base64 payloads", () => {
  const payload = { total: 2, jobs: [{ id: 1 }, { id: 2 }] };
  const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64");
  const decoded = decodeLevelsFyiApiPayload(gzipped);
  assert.deepEqual(decoded?.payload, payload);
  assert.equal(decoded?.decoder, "node:gzip");
});

test("Levels API payload decoder handles LZString base64 payloads", () => {
  const payload = { total: 1, jobs: [{ id: "lz" }] };
  const encoded = LZString.compressToBase64(JSON.stringify(payload));
  const decoded = decodeLevelsFyiApiPayload(encoded);
  assert.deepEqual(decoded?.payload, payload);
  assert.equal(decoded?.decoder, "lz-string");
});

test("Levels job merge dedupes by externalId", () => {
  const base = [{ externalId: "1", title: "A" }];
  const incoming = [{ externalId: "1", title: "A2" }, { externalId: "2", title: "B" }];
  const merged = mergeLevelsFyiJobsById(base, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((job) => job.externalId === "1")?.title, "A");
  assert.equal(merged.find((job) => job.externalId === "2")?.title, "B");
});

test("Levels DOM probe exposes company row samples", () => {
  const html = `
    <div class="jobs-directory-body-module-scss-module__XmM6sq__companiesListContainer">
      <div class="companyRow"><div class="companyName">Alpha</div></div>
      <div class="companyRow"><div class="companyName">Beta</div></div>
    </div>
  `;
  const { context } = createDomContext(html);
  const payload = JSON.parse(vm.runInContext(buildLevelsFyiDomProbeScript(), context));
  assert.ok(Array.isArray(payload.companyRowSample));
  assert.equal(payload.companyRowSample.length, 2);
  assert.equal(payload.companyRowSample[0].text, "Alpha");
});

test("Levels DOM totals parser extracts companies and job counts", () => {
  const html = `
    <div class="jobs-directory-body-module-scss-module__XmM6sq__companiesListContainer">
      <div class="jobs-directory-body-module-scss-module__XmM6sq__totalCounts">
        <span>13 companies hiring</span>
        <span>35 total jobs</span>
      </div>
    </div>
  `;
  const totals = parseLevelsFyiDomTotalsFromHtml(html);
  assert.deepEqual(totals, { totalJobs: 35, totalCompanies: 13 });
});

test("Levels company list script returns role-button companies", () => {
  const html = `
    <div class="jobs-directory-body-module-scss-module__XmM6sq__companiesListContainer">
      <div role="button"><h2 class="companyName">Alpha</h2></div>
      <div role="button"><h2 class="companyName">Beta</h2></div>
      <a href="/jobs?jobId=123">Job Link</a>
    </div>
  `;
  const { context, document } = createDomContext(html);
  const container = document.querySelector("div[class*='companiesListContainer']");
  Object.defineProperty(container, "scrollHeight", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(container, "scrollTop", { value: 0, writable: true, configurable: true });

  const payload = JSON.parse(vm.runInContext(buildLevelsFyiCompanyListScript(), context));
  assert.equal(payload.count, 2);
  assert.deepEqual(
    payload.companies.map((company) => company.name),
    ["Alpha", "Beta"]
  );
});

test("Levels company list uses company name nodes when role buttons absent", () => {
  const html = `
    <div class="jobs-directory-body-module-scss-module__XmM6sq__companiesListContainer">
      <div class="companyCard"><h2 class="companyName">Alpha</h2></div>
      <div class="companyCard"><h2 class="companyName">Beta</h2></div>
    </div>
  `;
  const { context, document } = createDomContext(html);
  const container = document.querySelector("div[class*='companiesListContainer']");
  Object.defineProperty(container, "scrollHeight", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(container, "scrollTop", { value: 0, writable: true, configurable: true });

  const payload = JSON.parse(vm.runInContext(buildLevelsFyiCompanyListScript(), context));
  assert.equal(payload.count, 2);
  assert.deepEqual(
    payload.companies.map((company) => company.name),
    ["Alpha", "Beta"]
  );
});

test("Levels min comp script targets minimum input inside dialog", () => {
  const html = `
    <input id="search" placeholder="Search by title, keyword or company" />
    <div role="dialog" class="total-comp-popover">
      <div>Minimum</div>
      <input id="minComp" type="text" />
    </div>
  `;
  const { context, document } = createDomContext(html);
  const searchInput = document.getElementById("search");
  const minInput = document.getElementById("minComp");
  searchInput.value = "ai";

  vm.runInContext(buildLevelsFyiSetMinCompScript(200000), context);

  assert.equal(minInput.value, "200000");
  assert.equal(searchInput.value, "ai");
});

test("Levels date posted script targets numeric day input", () => {
  const html = `
    <input id="search" placeholder="Search by title, keyword or company" />
    <input id="days" type="text" placeholder="30" />
  `;
  const { context, document } = createDomContext(html);
  const searchInput = document.getElementById("search");
  const daysInput = document.getElementById("days");
  searchInput.value = "ai";

  vm.runInContext(buildLevelsFyiSetDatePostedValueScript(3), context);

  assert.equal(daysInput.value, "3");
  assert.equal(searchInput.value, "ai");
});

test("Levels filter option selector clicks aria-label options", () => {
  const html = `
    <button id="opt" aria-label="Past 3 days"></button>
  `;
  const { context, document } = createDomContext(html);
  const button = document.getElementById("opt");
  button.addEventListener("click", () => {
    button.dataset.clicked = "true";
  });

  const payload = JSON.parse(
    vm.runInContext(buildLevelsFyiSelectFilterOptionScript("Past 3 days"), context)
  );

  assert.equal(payload.clicked, true);
  assert.equal(button.dataset.clicked, "true");
});

test("Levels filter options list includes aria-labels", () => {
  const html = `
    <button aria-label="Past 3 days"></button>
    <button>Past week</button>
  `;
  const { context } = createDomContext(html);
  const payload = JSON.parse(vm.runInContext(buildLevelsFyiListFilterOptionsScript(), context));
  assert.ok(payload.options.includes("Past 3 days"));
  assert.ok(payload.options.includes("Past week"));
});

test("Levels cookie dismiss handles Close button", () => {
  const html = `
    <div role="dialog" class="cky-banner">
      <button>Close</button>
    </div>
  `;
  const { context, document } = createDomContext(html);
  const button = document.querySelector("button");
  button.addEventListener("click", () => {
    button.dataset.clicked = "true";
  });

  const payload = JSON.parse(vm.runInContext(buildLevelsFyiCookieDismissScript(), context));

  assert.equal(payload.clicked, true);
  assert.equal(button.dataset.clicked, "true");
});

test("Levels readiness check requires toolbar or totals", () => {
  assert.equal(isLevelsFyiSearchReady(null), false);
  assert.equal(
    isLevelsFyiSearchReady({ filterButtonMatches: ["Location", "Total Comp"] }),
    true
  );
  assert.equal(
    isLevelsFyiSearchReady({ companiesContainerHtml: "<span>10 total jobs</span>" }),
    true
  );
});

test("Levels search input helper respects existing value", () => {
  const probe = {
    textInputs: [
      { placeholder: "Search by title, keyword or company", value: "ai" },
      { placeholder: "$1,250,000", value: "200000" }
    ]
  };
  assert.equal(getLevelsFyiSearchInputValue(probe), "ai");
  assert.equal(shouldApplyLevelsFyiSearchText("ai", probe), false);
  assert.equal(shouldApplyLevelsFyiSearchText("ml", probe), true);
});

test("Levels pagination scripts detect next and wait for job id change", () => {
  const html = `
    <div class="jobs">
      <a href="/jobs?jobId=1"><div class="companyJobTitle">Job 1</div></a>
    </div>
    <div class="pagination">
      <button aria-label="Next">Next</button>
    </div>
  `;
  const { context, document } = createDomContext(html);
  const nextButton = document.querySelector("[aria-label='Next']");
  nextButton.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = "/jobs?jobId=2";
    link.innerHTML = "<div class='companyJobTitle'>Job 2</div>";
    document.querySelector(".jobs").prepend(link);
  });

  const info = JSON.parse(vm.runInContext(buildLevelsFyiPaginationInfoScript(), context));
  assert.equal(info.nextExists, true);

  const clickPayload = JSON.parse(vm.runInContext(buildLevelsFyiPaginationClickNextScript(), context));
  assert.equal(clickPayload.clicked, true);

  const waitPayload = JSON.parse(
    vm.runInContext(buildLevelsFyiPaginationWaitScript("1"), context)
  );
  assert.equal(waitPayload.ready, true);
});

test("capturePaginatedJobsWithNavigator invokes navigation before page 2", () => {
  const calls = [];
  const payloads = [
    { jobs: [{ externalId: "1" }], expectedCount: 2 },
    { jobs: [{ externalId: "2" }], expectedCount: 2 }
  ];
  let index = 0;

  const result = capturePaginatedJobsWithNavigator({
    maxPages: 2,
    readPage: () => payloads[index++],
    navigatePage: (pageIndex) => calls.push(pageIndex)
  });

  assert.deepEqual(calls, [1]);
  assert.equal(result.jobs.length, 2);
});

test("Levels pagination guard uses nextExists", () => {
  assert.equal(shouldPaginateLevels({ nextExists: true }), true);
  assert.equal(shouldPaginateLevels({ nextExists: false }), false);
});
