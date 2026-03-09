import test from "node:test";
import assert from "node:assert/strict";

import { buildSearchUrlForSourceType } from "../src/sources/search-url-builder.js";

test("buildSearchUrlForSourceType includes OR + include/exclude controls for Indeed query text", () => {
  const result = buildSearchUrlForSourceType("indeed_search", {
    title: "senior product manager",
    keywords: "ai, fintech",
    keywordMode: "or",
    includeTerms: ["payments", "growth"],
    excludeTerms: ["intern", "contract"]
  });

  const parsed = new URL(result.url);
  const query = String(parsed.searchParams.get("q") || "");

  assert.match(query, /\sOR\s/i);
  assert.match(query, /payments/i);
  assert.match(query, /growth/i);
  assert.match(query, /-intern/i);
  assert.match(query, /-contract/i);

  assert.deepEqual(result.criteriaAccountability.appliedInUrl.sort(), [
    "excludeTerms",
    "includeTerms",
    "keywordMode",
    "keywords",
    "title"
  ]);
});

test("buildSearchUrlForSourceType marks include/exclude controls unsupported for Wellfound", () => {
  const result = buildSearchUrlForSourceType("wellfound_search", {
    keywords: "ai, fintech",
    keywordMode: "or",
    includeTerms: ["payments"],
    excludeTerms: ["contract"]
  });

  assert.deepEqual(result.criteriaAccountability.unsupported.sort(), [
    "excludeTerms",
    "includeTerms",
    "keywordMode",
    "keywords"
  ]);
});
