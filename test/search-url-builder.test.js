import test from "node:test";
import assert from "node:assert/strict";

import { buildSearchUrlForSourceType } from "../src/sources/search-url-builder.js";

test("buildSearchUrlForSourceType formats LinkedIn classic criteria with salary", () => {
  const result = buildSearchUrlForSourceType(
    "linkedin_capture_file",
    {
      title: "ai product manager",
      location: "San Francisco Bay Area",
      distanceMiles: 25,
      minSalary: 195000,
      datePosted: "1w",
      experienceLevel: "senior"
    },
    {
      baseUrl:
        "https://www.linkedin.com/jobs/search/?geoId=90000084&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true"
    }
  );

  const parsed = new URL(result.url);
  assert.equal(parsed.hostname, "www.linkedin.com");
  assert.equal(parsed.pathname, "/jobs/search/");
  assert.equal(parsed.searchParams.get("keywords"), "ai product manager");
  assert.equal(parsed.searchParams.get("location"), "San Francisco Bay Area");
  assert.equal(parsed.searchParams.get("distance"), "25");
  assert.equal(parsed.searchParams.get("f_TPR"), "r604800");
  assert.equal(parsed.searchParams.get("f_E"), "4");
  assert.equal(parsed.searchParams.get("f_SB2"), "9");
  assert.equal(parsed.searchParams.get("origin"), "JOB_SEARCH_PAGE_JOB_FILTER");
  assert.equal(parsed.searchParams.get("refresh"), "true");
  assert.deepEqual(result.unsupported, []);
});

test("buildSearchUrlForSourceType defaults LinkedIn base to classic search endpoint", () => {
  const result = buildSearchUrlForSourceType("linkedin_capture_file", {
    title: "product manager",
    keywords: "ai"
  });

  const parsed = new URL(result.url);
  assert.equal(parsed.pathname, "/jobs/search/");
  assert.equal(parsed.searchParams.get("keywords"), "product manager ai");
});

test("buildSearchUrlForSourceType formats ZipRecruiter criteria", () => {
  const result = buildSearchUrlForSourceType(
    "ziprecruiter_search",
    {
      title: "principal product manager",
      keywords: "b2b saas fintech payments",
      location: "San Francisco, CA",
      distanceMiles: 25,
      minSalary: 200000,
      datePosted: "1w",
      experienceLevel: "senior"
    },
    {
      baseUrl: "https://www.ziprecruiter.com/jobs-search?lk=stale&page=9"
    }
  );

  const parsed = new URL(result.url);
  assert.equal(parsed.hostname, "www.ziprecruiter.com");
  assert.equal(parsed.pathname, "/jobs-search");
  assert.equal(
    parsed.searchParams.get("search"),
    "principal product manager b2b saas fintech payments"
  );
  assert.equal(parsed.searchParams.get("location"), "San Francisco, CA");
  assert.equal(parsed.searchParams.get("radius"), "25");
  assert.equal(parsed.searchParams.get("refine_by_salary"), "200000");
  assert.equal(parsed.searchParams.get("days"), "7");
  assert.equal(parsed.searchParams.get("refine_by_experience_level"), "senior");
  assert.equal(parsed.searchParams.get("page"), "1");
  assert.equal(parsed.searchParams.get("lk"), null);
  assert.deepEqual(result.unsupported, []);
});

test("buildSearchUrlForSourceType formats Indeed criteria", () => {
  const result = buildSearchUrlForSourceType("indeed_search", {
    title: "senior product manager",
    keywords: "fintech payments",
    location: "San Francisco, CA",
    distanceMiles: 25,
    minSalary: 195000,
    datePosted: "3d",
    experienceLevel: "mid"
  });

  const parsed = new URL(result.url);
  assert.equal(parsed.hostname, "www.indeed.com");
  assert.equal(parsed.pathname, "/jobs");
  assert.equal(parsed.searchParams.get("q"), "senior product manager fintech payments");
  assert.equal(parsed.searchParams.get("l"), "San Francisco, CA");
  assert.equal(parsed.searchParams.get("radius"), "25");
  assert.equal(parsed.searchParams.get("salaryType"), "$195,000");
  assert.equal(parsed.searchParams.get("fromage"), "3");
  assert.ok(result.unsupported.includes("experienceLevel"));
});

test("buildSearchUrlForSourceType formats Google jobs-style criteria", () => {
  const result = buildSearchUrlForSourceType(
    "google_search",
    {
      title: "principal product manager",
      keywords: "b2b saas",
      location: "San Francisco",
      minSalary: 200000,
      datePosted: "2w"
    },
    {
      baseUrl: "https://www.google.com/search?ved=tracking-only"
    }
  );

  const parsed = new URL(result.url);
  assert.equal(parsed.hostname, "www.google.com");
  assert.equal(parsed.pathname, "/search");
  assert.match(String(parsed.searchParams.get("q")), /principal product manager/i);
  assert.match(String(parsed.searchParams.get("q")), /b2b saas/i);
  assert.match(String(parsed.searchParams.get("q")), /San Francisco/i);
  assert.match(String(parsed.searchParams.get("q")), /\$200,000\+/);
  assert.equal(parsed.searchParams.get("udm"), "8");
  assert.equal(parsed.searchParams.get("tbs"), "qdr:m");
  assert.equal(parsed.searchParams.get("ved"), null);
});

test("buildSearchUrlForSourceType stubs Wellfound criteria as unsupported", () => {
  const result = buildSearchUrlForSourceType(
    "wellfound_search",
    {
      title: "product manager",
      keywords: "product manager",
      location: "San Francisco",
      minSalary: 200000,
      datePosted: "1w",
      experienceLevel: "senior"
    },
    {
      baseUrl: "https://wellfound.com/jobs"
    }
  );

  assert.equal(result.url, "https://wellfound.com/jobs");
  assert.deepEqual(result.unsupported.sort(), [
    "datePosted",
    "experienceLevel",
    "keywords",
    "location",
    "minSalary",
    "title"
  ]);
});
