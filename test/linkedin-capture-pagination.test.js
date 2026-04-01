import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLinkedInPageUrl,
  doesLinkedInDetailIdMatch,
  isLinkedInSearchResultsUrl,
  shouldContinueLinkedInPagination,
  shouldFetchLinkedInPage
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

test("shouldFetchLinkedInPage stops before overshooting the known result count", () => {
  assert.equal(shouldFetchLinkedInPage(null, 0), true);
  assert.equal(shouldFetchLinkedInPage(48, 0), true);
  assert.equal(shouldFetchLinkedInPage(48, 1), true);
  assert.equal(shouldFetchLinkedInPage(48, 2), false);
  assert.equal(shouldFetchLinkedInPage(66, 2), true);
  assert.equal(shouldFetchLinkedInPage(66, 3), false);
});

test("doesLinkedInDetailIdMatch requires a resolved detail id when a card id is known", () => {
  assert.equal(doesLinkedInDetailIdMatch("", ""), true);
  assert.equal(doesLinkedInDetailIdMatch("123", "123"), true);
  assert.equal(doesLinkedInDetailIdMatch("123", ""), false);
  assert.equal(doesLinkedInDetailIdMatch("123", "999"), false);
});

test("shouldContinueLinkedInPagination stops after a short final page", () => {
  assert.equal(shouldContinueLinkedInPagination(25), true);
  assert.equal(shouldContinueLinkedInPagination(24), false);
  assert.equal(shouldContinueLinkedInPagination(9), false);
  assert.equal(shouldContinueLinkedInPagination(0), false);
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
