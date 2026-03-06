import test from "node:test";
import assert from "node:assert/strict";

import { buildLinkedInPageUrl } from "../src/browser-bridge/providers/chrome-applescript.js";

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
