import test from "node:test";
import assert from "node:assert/strict";

import { validateSources } from "../src/config/schema.js";

test("validateSources accepts wellfound and ashby source types", () => {
  const parsed = validateSources({
    sources: [
      {
        id: "li-ai",
        name: "LinkedIn AI",
        type: "linkedin_capture_file",
        enabled: true,
        searchUrl: "https://www.linkedin.com/jobs/search/?keywords=ai+product+manager",
        capturePath: "data/captures/li-ai.json",
        maxPages: 5,
        maxScrollSteps: 20,
        maxIdleScrollSteps: 4
      },
      {
        id: "wf-ai",
        name: "Wellfound AI",
        type: "wellfound_search",
        enabled: true,
        searchUrl: "https://wellfound.com/jobs",
        maxJobs: 30,
        cacheTtlHours: 24,
        requiredTerms: ["product manager", "ai"],
        hardFilter: {
          requiredAny: ["ai", "machine learning"],
          excludeAny: ["intern"],
          fields: ["title", "description"],
          enforceContentOnSnippets: false
        }
      },
      {
        id: "ashby-pm",
        name: "Ashby PM",
        type: "ashby_search",
        enabled: true,
        searchUrl: "https://jobs.ashbyhq.com/company",
        maxJobs: 40,
        recencyWindow: "1w"
      },
      {
        id: "google-ai",
        name: "Google AI PM",
        type: "google_search",
        enabled: true,
        searchUrl: "https://www.google.com/search?q=ai+product+manager+san+francisco",
        recencyWindow: "1w"
      },
      {
        id: "indeed-ai",
        name: "Indeed AI PM",
        type: "indeed_search",
        enabled: true,
        searchUrl: "https://www.indeed.com/jobs?q=product+manager+ai",
        searchCriteria: {
          title: "senior product manager",
          keywords: "product manager ai",
          location: "San Francisco, CA",
          distanceMiles: 25,
          minSalary: 195000,
          datePosted: "1w",
          experienceLevel: "senior"
        },
        criteriaAccountability: {
          appliedInUrl: [
            "title",
            "keywords",
            "location",
            "distanceMiles",
            "datePosted",
            "minSalary"
          ],
          appliedInUiBootstrap: [],
          appliedPostCapture: [],
          unsupported: ["experienceLevel"]
        },
        formatterDiagnostics: {
          unsupported: ["experienceLevel"],
          notes: ["experienceLevel criteria is unsupported for indeed_search"]
        }
      },
      {
        id: "zip-ai",
        name: "Zip AI PM",
        type: "ziprecruiter_search",
        enabled: true,
        searchUrl: "https://www.ziprecruiter.com/jobs-search?search=product+manager+ai"
      },
      {
        id: "remoteok-ai",
        name: "RemoteOK AI PM",
        type: "remoteok_search",
        enabled: true,
        searchUrl: "https://remoteok.com/remote-manager+saas-jobs"
      }
    ]
  });

  assert.equal(parsed.sources.length, 7);
  assert.equal(parsed.sources[0].type, "linkedin_capture_file");
  assert.equal(parsed.sources[0].maxPages, 5);
  assert.equal(parsed.sources[0].maxScrollSteps, 20);
  assert.equal(parsed.sources[0].maxIdleScrollSteps, 4);
  assert.equal(parsed.sources[1].type, "wellfound_search");
  assert.equal(parsed.sources[2].type, "ashby_search");
  assert.equal(parsed.sources[2].recencyWindow, "1w");
  assert.deepEqual(parsed.sources[1].requiredTerms, ["product manager", "ai"]);
  assert.deepEqual(parsed.sources[1].hardFilter.requiredAny, ["ai", "machine learning"]);
  assert.deepEqual(parsed.sources[1].hardFilter.excludeAny, ["intern"]);
  assert.deepEqual(parsed.sources[1].hardFilter.fields, ["title", "description"]);
  assert.equal(parsed.sources[1].hardFilter.enforceContentOnSnippets, false);
  assert.equal(parsed.sources[3].type, "google_search");
  assert.equal(parsed.sources[4].type, "indeed_search");
  assert.equal(parsed.sources[4].searchCriteria.title, "senior product manager");
  assert.equal(parsed.sources[4].searchCriteria.keywords, "product manager ai");
  assert.equal(parsed.sources[4].searchCriteria.location, "San Francisco, CA");
  assert.equal(parsed.sources[4].searchCriteria.distanceMiles, 25);
  assert.equal(parsed.sources[4].searchCriteria.minSalary, 195000);
  assert.equal(parsed.sources[4].searchCriteria.datePosted, "1w");
  assert.equal(parsed.sources[4].searchCriteria.experienceLevel, "senior");
  assert.deepEqual(parsed.sources[4].criteriaAccountability, {
    appliedInUrl: [
      "title",
      "keywords",
      "location",
      "distanceMiles",
      "datePosted",
      "minSalary"
    ],
    appliedInUiBootstrap: [],
    appliedPostCapture: [],
    unsupported: ["experienceLevel"]
  });
  assert.deepEqual(parsed.sources[4].formatterDiagnostics, {
    unsupported: ["experienceLevel"],
    notes: ["experienceLevel criteria is unsupported for indeed_search"]
  });
  assert.equal(parsed.sources[5].type, "ziprecruiter_search");
  assert.equal(parsed.sources[6].type, "remoteok_search");
});

test("validateSources defaults Ashby recencyWindow to 1m", () => {
  const parsed = validateSources({
    sources: [
      {
        id: "ashby-pm",
        name: "Ashby PM",
        type: "ashby_search",
        enabled: true,
        searchUrl: "https://jobs.ashbyhq.com/company"
      }
    ]
  });

  assert.equal(parsed.sources[0].recencyWindow, "1m");
});

test("validateSources defaults Google recencyWindow to 1w", () => {
  const parsed = validateSources({
    sources: [
      {
        id: "google-ai",
        name: "Google AI PM",
        type: "google_search",
        enabled: true,
        searchUrl: "https://www.google.com/search?q=ai+product+manager+san+francisco"
      }
    ]
  });

  assert.equal(parsed.sources[0].recencyWindow, "1w");
});

test("validateSources rejects invalid Ashby recencyWindow", () => {
  assert.throws(() =>
    validateSources({
      sources: [
        {
          id: "ashby-pm",
          name: "Ashby PM",
          type: "ashby_search",
          enabled: true,
          searchUrl: "https://jobs.ashbyhq.com/company",
          recencyWindow: "2w"
        }
      ]
    })
  );
});

test("validateSources rejects non-positive cacheTtlHours", () => {
  assert.throws(() =>
    validateSources({
      sources: [
        {
          id: "builtin-ai",
          name: "Built In",
          type: "builtin_search",
          enabled: true,
          searchUrl: "https://www.builtinsf.com/jobs/product-management",
          cacheTtlHours: 0
        }
      ]
    })
  );
});

test("validateSources rejects invalid searchCriteria values", () => {
  assert.throws(() =>
    validateSources({
      sources: [
        {
          id: "indeed-ai",
          name: "Indeed AI PM",
          type: "indeed_search",
          enabled: true,
          searchUrl: "https://www.indeed.com/jobs?q=product+manager+ai",
          searchCriteria: {
            datePosted: "90d",
            title: 123
          }
        }
      ]
    })
  );
});

test("validateSources rejects invalid hardFilter values", () => {
  assert.throws(() =>
    validateSources({
      sources: [
        {
          id: "wf-ai",
          name: "Wellfound AI",
          type: "wellfound_search",
          enabled: true,
          searchUrl: "https://wellfound.com/jobs",
          hardFilter: {
            requiredAny: "ai",
            enforceContentOnSnippets: "no"
          }
        }
      ]
    })
  );
});

test("validateSources accepts YC Jobs and Levels.fyi direct HTTP sources", () => {
  const parsed = validateSources({
    sources: [
      {
        id: "yc-product-jobs",
        name: "YC Jobs",
        type: "yc_jobs",
        enabled: true,
        searchUrl: "https://www.workatastartup.com/jobs",
        capturePath: "data/captures/yc-product-jobs.json",
        maxJobs: 50,
        cacheTtlHours: 12
      },
      {
        id: "levelsfyi-ai-pm",
        name: "Levels.fyi",
        type: "levelsfyi_search",
        enabled: true,
        searchUrl: "https://www.levels.fyi/jobs/",
        capturePath: "data/captures/levelsfyi-ai-pm.json",
        maxJobs: 40,
        cacheTtlHours: 12
      }
    ]
  });

  assert.equal(parsed.sources[0].type, "yc_jobs");
  assert.equal(parsed.sources[0].capturePath, "data/captures/yc-product-jobs.json");
  assert.equal(parsed.sources[0].maxJobs, 50);
  assert.equal(parsed.sources[1].type, "levelsfyi_search");
  assert.equal(parsed.sources[1].capturePath, "data/captures/levelsfyi-ai-pm.json");
  assert.equal(parsed.sources[1].maxJobs, 40);
});

test("validateSources rejects invalid formatterDiagnostics values", () => {
  assert.throws(() =>
    validateSources({
      sources: [
        {
          id: "indeed-ai",
          name: "Indeed AI PM",
          type: "indeed_search",
          enabled: true,
          searchUrl: "https://www.indeed.com/jobs?q=product+manager+ai",
          formatterDiagnostics: {
            unsupported: ["minSalary"],
            notes: "not-an-array"
          }
        }
      ]
    })
  );
});

test("validateSources rejects criteriaAccountability fields in multiple buckets", () => {
  assert.throws(() =>
    validateSources({
      sources: [
        {
          id: "indeed-ai",
          name: "Indeed AI PM",
          type: "indeed_search",
          enabled: true,
          searchUrl: "https://www.indeed.com/jobs?q=product+manager+ai",
          criteriaAccountability: {
            appliedInUrl: ["keywords"],
            unsupported: ["keywords"]
          }
        }
      ]
    })
  );
});

test("validateSources rejects invalid maxScrollSteps for browser sources", () => {
  assert.throws(() =>
    validateSources({
      sources: [
        {
          id: "li-ai",
          name: "LinkedIn AI",
          type: "linkedin_capture_file",
          enabled: true,
          searchUrl: "https://www.linkedin.com/jobs/search/?keywords=ai+product+manager",
          capturePath: "data/captures/li-ai.json",
          maxScrollSteps: 0
        }
      ]
    })
  );
});
