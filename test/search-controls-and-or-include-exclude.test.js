import test from "node:test";
import assert from "node:assert/strict";

import { buildSearchUrlForSourceType } from "../src/sources/search-url-builder.js";

test("buildSearchUrlForSourceType keeps exclude terms out of Indeed URL and applies them post-capture", () => {
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
  assert.equal(query.includes("-intern"), false);
  assert.equal(query.includes("-contract"), false);

  assert.deepEqual(result.criteriaAccountability.appliedInUrl.sort(), [
    "includeTerms",
    "keywordMode",
    "keywords",
    "title"
  ]);
  assert.deepEqual(result.criteriaAccountability.appliedPostCapture, ["excludeTerms"]);
});

test("buildSearchUrlForSourceType keeps exclude terms post-capture for Wellfound", () => {
  const result = buildSearchUrlForSourceType("wellfound_search", {
    keywords: "ai, fintech",
    keywordMode: "or",
    includeTerms: ["payments"],
    excludeTerms: ["contract"]
  });

  assert.deepEqual(result.criteriaAccountability.unsupported.sort(), [
    "includeTerms",
    "keywordMode",
    "keywords"
  ]);
  assert.deepEqual(result.criteriaAccountability.appliedPostCapture, ["excludeTerms"]);
});
