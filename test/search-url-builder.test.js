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

test("buildSearchUrlForSourceType includes LinkedIn hard include terms in the query", () => {
  const result = buildSearchUrlForSourceType("linkedin_capture_file", {
    title: "product manager",
    hardIncludeTerms: ["ai"],
    scoreKeywords: ["growth", "cleantech"]
  });

  const parsed = new URL(result.url);
  assert.equal(parsed.pathname, "/jobs/search/");
  assert.equal(parsed.searchParams.get("keywords"), "product manager ai");
  assert.equal(parsed.searchParams.get("keywords")?.includes("growth"), false);
  assert.equal(parsed.searchParams.get("keywords")?.includes("cleantech"), false);
});

test("buildSearchUrlForSourceType formats ZipRecruiter criteria", () => {
  const result = buildSearchUrlForSourceType(
    "ziprecruiter_search",
    {
      title: "principal product manager",
      keywords: "b2b saas fintech payments",
      location: "San Francisco",
      distanceMiles: 25,
      minSalary: 200000,
      datePosted: "1w",
    },
    {
      baseUrl:
        "https://www.ziprecruiter.com/jobs-search?location=San+Francisco%2C+CA&radius=25&refine_by_employment=employment_type%3Aall&refine_by_experience_level=mid%2Csenior&lk=stale&page=9"
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
  assert.equal(parsed.searchParams.get("radius"), null);
  assert.equal(parsed.searchParams.get("refine_by_salary"), null);
  assert.equal(parsed.searchParams.get("days"), null);
  assert.equal(parsed.searchParams.get("refine_by_experience_level"), "mid,senior");
  assert.equal(parsed.searchParams.get("refine_by_employment"), "employment_type:all");
  assert.equal(parsed.searchParams.get("page"), "1");
  assert.equal(parsed.searchParams.get("lk"), null);
  assert.deepEqual(result.unsupported, []);
  assert.deepEqual(result.criteriaAccountability.appliedInUrl.sort(), [
    "keywords",
    "location",
    "title"
  ]);
  assert.deepEqual(result.criteriaAccountability.appliedPostCapture.sort(), [
    "datePosted",
    "distanceMiles",
    "minSalary"
  ]);
});

test("buildSearchUrlForSourceType preserves richer LinkedIn location when criteria only specifies city", () => {
  const result = buildSearchUrlForSourceType(
    "linkedin_capture_file",
    {
      title: "product manager",
      hardIncludeTerms: ["ai"],
      location: "San Francisco",
      datePosted: "3d",
      minSalary: 200000
    },
    {
      baseUrl:
        "https://www.linkedin.com/jobs/search/?location=San+Francisco%2C+CA&distance=25"
    }
  );

  const parsed = new URL(result.url);
  assert.equal(parsed.searchParams.get("location"), "San Francisco, CA");
  assert.equal(parsed.searchParams.get("distance"), "25");
  assert.equal(parsed.searchParams.get("keywords"), "product manager ai");
});

test("buildSearchUrlForSourceType formats Indeed criteria", () => {
  const result = buildSearchUrlForSourceType("indeed_search", {
    title: "senior product manager",
    keywords: "fintech, payments, fintech",
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
  assert.equal(parsed.searchParams.get("radius"), null);
  assert.equal(parsed.searchParams.get("salaryType"), null);
  assert.equal(parsed.searchParams.get("fromage"), null);
  assert.ok(result.unsupported.includes("experienceLevel"));
});

test("buildSearchUrlForSourceType formats Google jobs-style criteria", () => {
  const result = buildSearchUrlForSourceType(
    "google_search",
    {
      title: "principal product manager",
      keywords: "b2b saas, fintech, payments",
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
  assert.match(String(parsed.searchParams.get("q")), /fintech/i);
  assert.match(String(parsed.searchParams.get("q")), /payments/i);
  assert.equal(String(parsed.searchParams.get("q")).includes("saas,"), false);
  assert.equal(String(parsed.searchParams.get("q")).includes("fintech,"), false);
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

test("buildSearchUrlForSourceType returns accountability buckets for Indeed criteria", () => {
  const result = buildSearchUrlForSourceType("indeed_search", {
    title: "senior product manager",
    keywords: "fintech payments",
    location: "San Francisco, CA",
    distanceMiles: 25,
    minSalary: 195000,
    datePosted: "3d",
    experienceLevel: "mid"
  });

  assert.ok(result.criteriaAccountability);
  assert.deepEqual(result.criteriaAccountability.appliedInUiBootstrap, []);
  assert.deepEqual(result.criteriaAccountability.appliedPostCapture.sort(), [
    "datePosted",
    "distanceMiles",
    "minSalary"
  ]);
  assert.deepEqual(result.criteriaAccountability.appliedInUrl.sort(), [
    "keywords",
    "location",
    "title"
  ]);
  assert.deepEqual(result.criteriaAccountability.unsupported, ["experienceLevel"]);
  assert.deepEqual(result.unsupported, result.criteriaAccountability.unsupported);
});

test("buildSearchUrlForSourceType encodes YC browser search state in a deterministic product route", () => {
  const result = buildSearchUrlForSourceType("yc_jobs", {
    title: "product manager",
    hardIncludeTerms: ["ai"],
    location: "San Francisco, CA",
    datePosted: "3d",
    minSalary: 200000
  });

  const parsed = new URL(result.url);
  assert.equal(parsed.origin, "https://www.workatastartup.com");
  assert.equal(parsed.pathname, "/jobs/l/product-manager");
  assert.equal(parsed.searchParams.get("search"), "product manager ai");
  assert.equal(parsed.searchParams.get("location"), "San Francisco, CA");
  assert.equal(parsed.searchParams.get("datePosted"), "3d");
  assert.equal(parsed.searchParams.get("minSalary"), "200000");
  assert.equal(result.criteriaAccountability.appliedInUrl.includes("title"), true);
  assert.equal(result.criteriaAccountability.appliedPostCapture.includes("hardIncludeTerms"), true);
});
