import test from "node:test";
import assert from "node:assert/strict";

import { getIndeedNativeFilterState } from "../src/sources/indeed-jobs.js";

test("getIndeedNativeFilterState reads corrected native Indeed parity filters from search URL", () => {
  const state = getIndeedNativeFilterState({
    type: "indeed_search",
    searchUrl:
      "https://www.indeed.com/jobs?q=Product+manager+ai&l=San+Francisco%2C+CA&fromage=3&salaryType=%24200%2C000%2B&radius=0"
  });

  assert.deepEqual(state, {
    queryValue: "Product manager ai",
    locationValue: "San Francisco, CA",
    appliedPayFilter: "$200,000+",
    appliedDatePostedFilter: "last 3 days",
    appliedDistanceFilter: "exact location only"
  });
});

