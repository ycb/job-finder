import test from "node:test";
import assert from "node:assert/strict";

import { validateSources } from "../src/config/schema.js";

test("validateSources accepts wellfound and ashby source types", () => {
  const parsed = validateSources({
    sources: [
      {
        id: "wf-ai",
        name: "Wellfound AI",
        type: "wellfound_search",
        enabled: true,
        searchUrl: "https://wellfound.com/jobs",
        maxJobs: 30,
        cacheTtlHours: 24,
        requiredTerms: ["product manager", "ai"]
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

  assert.equal(parsed.sources.length, 6);
  assert.equal(parsed.sources[0].type, "wellfound_search");
  assert.equal(parsed.sources[1].type, "ashby_search");
  assert.equal(parsed.sources[1].recencyWindow, "1w");
  assert.deepEqual(parsed.sources[0].requiredTerms, ["product manager", "ai"]);
  assert.equal(parsed.sources[2].type, "google_search");
  assert.equal(parsed.sources[3].type, "indeed_search");
  assert.equal(parsed.sources[3].searchCriteria.title, "senior product manager");
  assert.equal(parsed.sources[3].searchCriteria.keywords, "product manager ai");
  assert.equal(parsed.sources[3].searchCriteria.location, "San Francisco, CA");
  assert.equal(parsed.sources[3].searchCriteria.distanceMiles, 25);
  assert.equal(parsed.sources[3].searchCriteria.minSalary, 195000);
  assert.equal(parsed.sources[3].searchCriteria.datePosted, "1w");
  assert.equal(parsed.sources[3].searchCriteria.experienceLevel, "senior");
  assert.equal(parsed.sources[4].type, "ziprecruiter_search");
  assert.equal(parsed.sources[5].type, "remoteok_search");
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
