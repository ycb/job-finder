import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLinkedInPageUrl,
  isLinkedInSearchResultsUrl
} from "../src/browser-bridge/providers/chrome-applescript.js";

test("buildLinkedInPageUrl applies LinkedIn start offset in 25-result increments", () => {
  const baseUrl =
    "https://www.linkedin.com/jobs/search/?keywords=ai+product+manager&location=San+Francisco";

  assert.equal(buildLinkedInPageUrl(baseUrl, 0), baseUrl + "&start=0");
  assert.equal(buildLinkedInPageUrl(baseUrl, 1), baseUrl + "&start=25");
  assert.equal(buildLinkedInPageUrl(baseUrl, 2), baseUrl + "&start=50");
});

test("buildLinkedInPageUrl replaces existing start query parameter", () => {
  const baseUrl =
    "https://www.linkedin.com/jobs/search/?keywords=ai+pm&start=75&f_TPR=r604800";

  assert.equal(
    buildLinkedInPageUrl(baseUrl, 0),
    "https://www.linkedin.com/jobs/search/?keywords=ai+pm&start=0&f_TPR=r604800"
  );
});

test("isLinkedInSearchResultsUrl accepts search pages and rejects similar jobs collections", () => {
  assert.equal(
    isLinkedInSearchResultsUrl(
      "https://www.linkedin.com/jobs/search/?distance=25&keywords=Product%20manager%20ai"
    ),
    true
  );
  assert.equal(
    isLinkedInSearchResultsUrl(
      "https://www.linkedin.com/jobs/search-results/?keywords=Product%20manager"
    ),
    true
  );
  assert.equal(
    isLinkedInSearchResultsUrl(
      "https://www.linkedin.com/jobs/collections/similar-jobs/?currentJobId=4379860891&referenceJobId=4379860891"
    ),
    false
  );
});
