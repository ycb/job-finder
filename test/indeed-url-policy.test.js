import test from "node:test";
import assert from "node:assert/strict";

import {
  filterIndeedCapturedJobs,
  isIndeedJobUrl
} from "../src/sources/indeed-jobs.js";

test("isIndeedJobUrl accepts real Indeed job links", () => {
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/viewjob?jk=abc12345def67890"),
    true
  );
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/rc/clk?jk=abc12345def67890&vjs=3"),
    true
  );
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/pagead/clk?jk=abc12345def67890&from=vj"),
    false
  );
});

test("isIndeedJobUrl rejects Indeed salary and career pages even when fromjk is present", () => {
  assert.equal(
    isIndeedJobUrl(
      "https://www.indeed.com/career/principal-product-manager/salaries/San-Francisco--CA?campaignid=serp-more&fromjk=abc12345def67890&from=serp-more"
    ),
    false
  );
  assert.equal(
    isIndeedJobUrl(
      "https://www.indeed.com/career/platform-manager/salaries/San-Francisco--CA"
    ),
    false
  );
});

test("isIndeedJobUrl rejects known synthetic placeholder viewjob ids", () => {
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/viewjob?jk=a1b2c3d4e5f67890"),
    false
  );
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/viewjob?jk=123456789abcdef0"),
    false
  );
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/viewjob?jk=456789abcdef0123"),
    false
  );
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/viewjob?jk=890abcdef0123456"),
    false
  );
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/viewjob?jk=cdef0123456789ab"),
    false
  );
  assert.equal(
    isIndeedJobUrl("https://www.indeed.com/viewjob?jk=f1e2d3c4b5a67890"),
    false
  );
});

test("filterIndeedCapturedJobs removes salary and career rows from a mixed capture fixture", () => {
  const filtered = filterIndeedCapturedJobs([
    {
      title: "Product Manager II, Workspace Context, Gen AI Foundations",
      url: "https://www.indeed.com/viewjob?jk=2c6a74783ad4c265"
    },
    {
      title: "Product Manager II salaries in San Francisco, CA",
      url: "https://www.indeed.com/career/product-manager-ii/salaries/San-Francisco--CA?campaignid=serp-more&fromjk=2c6a74783ad4c265&from=serp-more"
    },
    {
      title: "Senior Product Manager, AI platform (Michelangelo)",
      url: "https://www.indeed.com/rc/clk?jk=abcdef1234567890&vjs=3"
    }
  ]);

  assert.deepEqual(
    filtered.map((job) => job.url),
    [
      "https://www.indeed.com/viewjob?jk=2c6a74783ad4c265",
      "https://www.indeed.com/rc/clk?jk=abcdef1234567890&vjs=3"
    ]
  );
});
