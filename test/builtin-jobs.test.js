import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  collectBuiltInJobsFromSearch,
  parseBuiltInExpectedCount
} from "../src/sources/builtin-jobs.js";
import { readSourceCaptureSummary } from "../src/sources/cache-policy.js";

function createTempCapturePath(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    capturePath: path.join(tempDir, "capture.json")
  };
}

function buildBuiltInHtml({ expectedText = "", cards = [] } = {}) {
  return `
    <main>
      <h1>${expectedText}</h1>
      <script>${cards.map((card) => `'id': ${card.id}, 'published_date':'${card.publishedDate || "2026-04-16"}'`).join("\n")}</script>
      ${cards
        .map(
          (card) => `
            <div id="job-card-${card.id}">
              <a data-id="job-card-title" href="/job/${card.slug}">${card.title}</a>
              <a data-id="company-title" href="/company/${card.companySlug}">${card.company}</a>
              <i class="fa-regular fa-location-dot"></i><span class="font-barlow text-gray-04">${card.location}</span>
              <i class="fa-regular fa-sack-dollar"></i><span class="font-barlow text-gray-04">${card.salary}</span>
              <i class="fa-regular fa-clock"></i>${card.posted}</span>
              <div class="fs-sm fw-regular mb-md text-gray-04">${card.summary}</div>
            </div>
          `
        )
        .join("\n")}
    </main>
  `;
}

test("parseBuiltInExpectedCount reads native displayed totals", () => {
  assert.equal(parseBuiltInExpectedCount("<h1>Showing 1-3 of 3 jobs</h1>"), 3);
  assert.equal(parseBuiltInExpectedCount("<p>27 jobs available</p>"), 27);
});

test("collectBuiltInJobsFromSearch writes direct-fetch diagnostics when parser matches displayed count", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-builtin-direct-");
  const source = {
    id: "builtin-test",
    name: "Built In",
    type: "builtin_search",
    searchUrl: "https://www.builtinsf.com/jobs?search=ai",
    capturePath
  };

  try {
    const jobs = collectBuiltInJobsFromSearch(source, {
      fetchHtml() {
        return buildBuiltInHtml({
          expectedText: "Showing 1-2 of 2 jobs",
          cards: [
            {
              id: "1001",
              slug: "ai-product-manager/1001",
              title: "AI Product Manager",
              company: "Example AI",
              companySlug: "example-ai",
              location: "San Francisco, CA",
              salary: "$200K - $240K",
              posted: "1 day ago",
              summary: "Build AI products."
            },
            {
              id: "1002",
              slug: "senior-product-manager/1002",
              title: "Senior Product Manager",
              company: "Example Two",
              companySlug: "example-two",
              location: "San Francisco, CA",
              salary: "$210K - $260K",
              posted: "2 days ago",
              summary: "Build platform products."
            }
          ]
        });
      },
      enrichJobs(jobsToEnrich) {
        return jobsToEnrich;
      }
    });

    const summary = readSourceCaptureSummary(source);
    assert.equal(jobs.length, 2);
    assert.equal(summary.expectedCount, 2);
    assert.deepEqual(summary.payload.captureDiagnostics, {
      captureMode: "direct_fetch",
      generatedUrl: source.searchUrl,
      pageUrl: source.searchUrl,
      expectedCount: 2,
      cardsSeen: 2,
      jobsAccepted: 2,
      jobsRejected: 0,
      rejectedReasons: [],
      pagesVisited: 1,
      stopReason: "direct_fetch_complete",
      runtimeError: null
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("collectBuiltInJobsFromSearch fails honestly when direct parser under-harvests displayed count", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-builtin-underharvest-");
  const source = {
    id: "builtin-test",
    name: "Built In",
    type: "builtin_search",
    searchUrl: "https://www.builtinsf.com/jobs?search=ai",
    capturePath
  };

  try {
    assert.throws(
      () =>
        collectBuiltInJobsFromSearch(source, {
          fetchHtml() {
            return buildBuiltInHtml({
              expectedText: "Showing 1-10 of 12 jobs",
              cards: [
                {
                  id: "1001",
                  slug: "ai-product-manager/1001",
                  title: "AI Product Manager",
                  company: "Example AI",
                  companySlug: "example-ai",
                  location: "San Francisco, CA",
                  salary: "$200K - $240K",
                  posted: "1 day ago",
                  summary: "Build AI products."
                }
              ]
            });
          },
          enrichJobs(jobsToEnrich) {
            return jobsToEnrich;
          }
        }),
      /under-harvested/i
    );

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.payload.captureDiagnostics.stopReason, "direct_fetch_under_harvest");
    assert.equal(summary.payload.captureDiagnostics.expectedCount, 12);
    assert.equal(summary.payload.captureDiagnostics.jobsAccepted, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
