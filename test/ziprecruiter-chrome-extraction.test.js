import test from "node:test";
import assert from "node:assert/strict";

import { buildZipRecruiterPageUrl } from "../src/browser-bridge/providers/chrome-applescript.js";

test("buildZipRecruiterPageUrl uses canonical first page without path suffix", () => {
  const url = buildZipRecruiterPageUrl(
    "https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco%2C+CA&radius=25&days=3&refine_by_salary=200000&refine_by_employment=employment_type%3Aall&page=1",
    1
  );

  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/jobs-search");
  assert.equal(parsed.searchParams.get("page"), null);
  assert.equal(parsed.searchParams.get("location"), "San Francisco, CA");
});

test("buildZipRecruiterPageUrl uses path-style pagination for later pages", () => {
  const url = buildZipRecruiterPageUrl(
    "https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco%2C+CA&radius=25&days=3&refine_by_salary=200000&refine_by_employment=employment_type%3Aall&page=1",
    2
  );

  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/jobs-search/2");
  assert.equal(parsed.searchParams.get("page"), null);
  assert.equal(parsed.searchParams.get("location"), "San Francisco, CA");
  assert.equal(parsed.searchParams.get("refine_by_salary"), "200000");
});
