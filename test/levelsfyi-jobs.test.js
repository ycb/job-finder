import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LEVELSFYI_SOURCE_NOTES,
  buildLevelsFyiApiUrl,
  buildLevelsFyiSearchUrl,
  collectLevelsFyiJobsFromSearch,
  parseLevelsFyiSearchPayload,
  parseLevelsFyiSearchHtml,
  toLevelsFyiReviewUrl
} from "../src/sources/levelsfyi-jobs.js";

function createTempCapturePath(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    capturePath: path.join(tempDir, "capture.json")
  };
}

function buildLevelsFixture({
  detailId = "105462002247180998",
  includeDetail = true,
  total = 2
} = {}) {
  return `
    <html>
      <head>
        <script id="__NEXT_DATA__" type="application/json">
          ${JSON.stringify(
            {
              props: {
                pageProps: {
                  initialFilters: {
                    limitPerCompany: 3,
                    limit: 5,
                    offset: 0,
                    sortBy: "relevance",
                    jobFamilySlugs: ["product-manager"],
                    locationSlugs: ["san-francisco-bay-area"]
                  },
                  initialJobsData: {
                    results: [
                      {
                        companyName: "Meta",
                        companySlug: "meta",
                        shortDescription: "Building products for billions.",
                        employeeCount: 100000,
                        estimatedValuation: 1000000000,
                        jobs: [
                          {
                            id: "105462002247180998",
                            title: "Product Manager",
                            locations: ["San Francisco, CA"],
                            applicationUrl: "https://www.metacareers.com/jobs/1238249364564427/",
                            postingDate: "2026-03-10T06:50:20.000Z",
                            expiryDate: "2026-04-16T06:50:21.000Z",
                            minBaseSalary: 173000,
                            maxBaseSalary: 241000,
                            baseSalaryCurrency: "USD",
                            minTotalSalary: 219000,
                            maxTotalSalary: 2001000
                          },
                          {
                            id: "119979182833705670",
                            title: "Product Manager",
                            locations: ["San Francisco, CA"],
                            applicationUrl: "https://www.metacareers.com/jobs/961472602841468/",
                            postingDate: "2026-02-24T05:19:26.000Z",
                            expiryDate: "2026-04-02T04:19:27.000Z",
                            minBaseSalary: 146000,
                            maxBaseSalary: 204000,
                            baseSalaryCurrency: "USD",
                            minTotalSalary: 192000,
                            maxTotalSalary: 1964000
                          }
                        ]
                      }
                    ],
                    total,
                    totalMatchingJobs: total
                  },
                  initialJobDetails: includeDetail
                    ? {
                        id: detailId,
                        title: "Product Manager",
                        description: "Lead the product surface.",
                        locations: ["San Francisco, CA"],
                        applicationUrl: "https://www.metacareers.com/jobs/1238249364564427/",
                        postingDate: "2026-03-10T06:50:20.000Z",
                        expiryDate: "2026-04-16T06:50:21.000Z",
                        workArrangement: "Hybrid",
                        companyInfo: {
                          name: "Meta",
                          slug: "meta",
                          description: "Building products for billions.",
                          website: "https://about.meta.com",
                          hqCity: "Menlo Park",
                          hqStateCode: "CA",
                          countryCodeIso2: "US",
                          icon: "https://example.invalid/meta.png",
                          iconLarge: null,
                          empCount: 100000,
                          companyType: "public",
                          estimatedValuation: 1000000000,
                          perks: []
                        },
                        jobFamilySlug: "product-manager",
                        postalAddresses: [],
                        employmentTypes: ["full_time"],
                        totalCompensationEstimates: [],
                        minBaseSalary: 173000,
                        maxBaseSalary: 241000,
                        baseSalaryCurrency: "USD",
                        minTotalSalary: 219000,
                        maxTotalSalary: 2001000
                      }
                    : null
                }
              }
            },
            null,
            2
          )}
        </script>
      </head>
      <body></body>
    </html>
  `;
}

function buildLevelsApiPayload({
  detailId = "105462002247180998",
  includeDetail = true,
  total = 2
} = {}) {
  return {
    results: [
      {
        companyName: "Meta",
        companySlug: "meta",
        shortDescription: "Building products for billions.",
        employeeCount: 100000,
        estimatedValuation: 1000000000,
        jobs: [
          {
            id: "105462002247180998",
            title: "Product Manager",
            locations: ["San Francisco, CA"],
            applicationUrl: "https://www.metacareers.com/jobs/1238249364564427/",
            postingDate: "2026-03-10T06:50:20.000Z",
            expiryDate: "2026-04-16T06:50:21.000Z",
            minBaseSalary: 173000,
            maxBaseSalary: 241000,
            baseSalaryCurrency: "USD",
            minTotalSalary: 219000,
            maxTotalSalary: 2001000
          },
          {
            id: "119979182833705670",
            title: "Product Manager",
            locations: ["San Francisco, CA"],
            applicationUrl: "https://www.metacareers.com/jobs/961472602841468/",
            postingDate: "2026-02-24T05:19:26.000Z",
            expiryDate: "2026-04-02T04:19:27.000Z",
            minBaseSalary: 146000,
            maxBaseSalary: 204000,
            baseSalaryCurrency: "USD",
            minTotalSalary: 192000,
            maxTotalSalary: 1964000
          }
        ]
      }
    ],
    total,
    totalMatchingJobs: total,
    initialJobDetails: includeDetail
      ? {
          id: detailId,
          title: "Product Manager",
          description: "Lead the product surface.",
          locations: ["San Francisco, CA"],
          applicationUrl: "https://www.metacareers.com/jobs/1238249364564427/",
          postingDate: "2026-03-10T06:50:20.000Z",
          expiryDate: "2026-04-16T06:50:21.000Z",
          workArrangement: "Hybrid",
          companyInfo: {
            name: "Meta",
            slug: "meta",
            description: "Building products for billions.",
            website: "https://about.meta.com",
            hqCity: "Menlo Park",
            hqStateCode: "CA",
            countryCodeIso2: "US",
            icon: "https://example.invalid/meta.png",
            iconLarge: null,
            empCount: 100000,
            companyType: "public",
            estimatedValuation: 1000000000,
            perks: []
          },
          jobFamilySlug: "product-manager",
          postalAddresses: [],
          employmentTypes: ["full_time"],
          totalCompensationEstimates: [],
          minBaseSalary: 173000,
          maxBaseSalary: 241000,
          baseSalaryCurrency: "USD",
          minTotalSalary: 219000,
          maxTotalSalary: 2001000
        }
      : null
  };
}

function buildLevelsApiPayloadForJobs(jobIds, { totalMatchingJobs } = {}) {
  const jobs = jobIds.map((id) => ({
    id,
    title: "Product Manager",
    locations: ["San Francisco, CA"],
    applicationUrl: `https://example.com/jobs/${id}`,
    postingDate: "2026-03-10T06:50:20.000Z",
    expiryDate: "2026-04-16T06:50:21.000Z",
    minBaseSalary: 173000,
    maxBaseSalary: 241000,
    baseSalaryCurrency: "USD",
    minTotalSalary: 219000,
    maxTotalSalary: 2001000
  }));

  const total = jobIds.length;
  return {
    results: [
      {
        companyName: "Meta",
        companySlug: "meta",
        shortDescription: "Building products for billions.",
        employeeCount: 100000,
        estimatedValuation: 1000000000,
        jobs
      }
    ],
    total,
    totalMatchingJobs: Number.isInteger(totalMatchingJobs) ? totalMatchingJobs : total
  };
}

test("Levels.fyi source notes capture the adapter contract", () => {
  assert.equal(LEVELSFYI_SOURCE_NOTES.sourceType, "levelsfyi_search");
  assert.match(LEVELSFYI_SOURCE_NOTES.canonicalReviewTarget, /jobId=<id>/);
  assert.ok(LEVELSFYI_SOURCE_NOTES.supportedCriteria.includes("minBaseCompensation -> minBaseCompensation"));
  assert.ok(LEVELSFYI_SOURCE_NOTES.unsupportedCriteria.includes("exclude terms"));
  assert.ok(LEVELSFYI_SOURCE_NOTES.minimumExtractionContract.includes("canonical review target via jobId"));
});

test("buildLevelsFyiSearchUrl maps criteria to a direct Levels.fyi jobs URL", () => {
  const url = buildLevelsFyiSearchUrl({
    title: "Product Manager",
    location: "San Francisco, USA",
    searchText: "ai",
    minSalary: 200000,
    postedAfterTimeType: "days",
    postedAfterValue: 3,
    sortBy: "relevance"
  });

  assert.equal(
    url,
    "https://www.levels.fyi/jobs/title/product-manager/location/san-francisco-bay-area?searchText=ai&minBaseCompensation=200000&postedAfterTimeType=days&postedAfterValue=3&sortBy=relevance"
  );
});

test("buildLevelsFyiApiUrl uses a stable API search query shape", () => {
  const url = buildLevelsFyiApiUrl({
    title: "Product Manager",
    location: "San Francisco, USA",
    searchText: "ai",
    minSalary: 200000,
    postedAfterTimeType: "days",
    postedAfterValue: 3,
    sortBy: "relevance"
  });

  assert.equal(
    url,
    "https://api.levels.fyi/v1/job/search?limitPerCompany=25&limit=200&offset=0&sortBy=relevance&searchText=ai&minBaseCompensation=200000&postedAfterTimeType=days&postedAfterValue=3&jobFamilySlugs%5B0%5D=product-manager&locationSlugs%5B0%5D=san-francisco-bay-area"
  );
});

test("parseLevelsFyiSearchHtml extracts canonical review targets and salary-rich metadata", () => {
  const jobs = parseLevelsFyiSearchHtml(
    buildLevelsFixture({ includeDetail: true, total: 1 }),
    "https://www.levels.fyi/jobs/title/product-manager/location/san-francisco-bay-area?minBaseCompensation=200000&postedAfterTimeType=days&postedAfterValue=3&searchText=ai"
  );

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "Product Manager");
  assert.equal(jobs[0].company, "Meta");
  assert.equal(jobs[0].url, toLevelsFyiReviewUrl("105462002247180998"));
  assert.match(jobs[0].salaryText, /\$173,000/);
  assert.match(jobs[0].summary, /\$219,000 - \$2,001,000/);
  assert.equal(jobs[0].employmentType, "full_time");
  assert.equal(jobs[0].description, "Lead the product surface.");
});

test("parseLevelsFyiSearchPayload extracts jobs from the API response shape", () => {
  const jobs = parseLevelsFyiSearchPayload(
    buildLevelsApiPayload({ includeDetail: true, total: 1 }),
    "https://www.levels.fyi/jobs/title/product-manager/location/san-francisco-bay-area?minBaseCompensation=200000&postedAfterTimeType=days&postedAfterValue=3&searchText=ai"
  );

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "Product Manager");
  assert.equal(jobs[0].company, "Meta");
  assert.equal(jobs[0].url, toLevelsFyiReviewUrl("105462002247180998"));
  assert.match(jobs[0].salaryText, /\$173,000/);
  assert.match(jobs[0].summary, /\$219,000 - \$2,001,000/);
  assert.equal(jobs[0].employmentType, "full_time");
  assert.equal(jobs[0].description, "Lead the product surface.");
});

test("collectLevelsFyiJobsFromSearch writes a capture payload and respects maxJobs", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-levels-collect-");
  const source = {
    id: "levels-pm",
    name: "Levels.fyi",
    type: "levelsfyi_search",
    searchUrl:
      "https://www.levels.fyi/jobs/title/product-manager/location/san-francisco-bay-area?searchText=ai&minBaseCompensation=200000",
    capturePath,
    maxJobs: 1
  };

  try {
    const jobs = collectLevelsFyiJobsFromSearch(source, {
      fetchJson() {
        return buildLevelsApiPayload({ includeDetail: false, total: 2 });
      }
    });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "105462002247180998");
    assert.equal(jobs[0].url, toLevelsFyiReviewUrl("105462002247180998"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("collectLevelsFyiJobsFromSearch paginates API payloads until maxJobs", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-levels-pages-");
  const source = {
    id: "levels-pm",
    name: "Levels.fyi",
    type: "levelsfyi_search",
    searchUrl: "https://www.levels.fyi/jobs?searchText=ai",
    capturePath,
    maxJobs: 3
  };
  const calls = [];

  try {
    const jobs = collectLevelsFyiJobsFromSearch(source, {
      fetchJson(searchUrl, { offset }) {
        calls.push({ searchUrl, offset });
        if (String(offset) === "0") {
          return buildLevelsApiPayloadForJobs(["job-1", "job-2"], { totalMatchingJobs: 4 });
        }
        return buildLevelsApiPayloadForJobs(["job-3", "job-4"], { totalMatchingJobs: 4 });
      }
    });

    assert.equal(jobs.length, 3);
    assert.equal(jobs[0].externalId, "job-1");
    assert.equal(jobs[2].externalId, "job-3");
    assert.equal(calls.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
